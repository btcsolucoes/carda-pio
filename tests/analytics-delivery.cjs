const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('docs/index.html','utf8');
function setup(fetch){
  const storage=new Map();
  const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k),key:i=>[...storage.keys()][i],get length(){return storage.size;}};
  const c=vm.createContext({Map,JSON,Date,AbortSignal,crypto:require('node:crypto').webcrypto,localStorage,navigator:{onLine:true},fetch,window:{addEventListener(){}},setTimeout(){},setInterval(){},QRSTACK_ANALYTICS_ENDPOINT:'https://test.invalid',QRSTACK_PENDING_PAGEVIEWS_KEY:'pending'});
  vm.runInContext(html.slice(html.indexOf('const criarIdEventoQrStack='),html.indexOf('const montarPayloadQrStack=')),c);
  return {c,storage,run:code=>vm.runInContext(code,c)};
}
test('failed delivery keeps dish events and stable IDs until acknowledgement',async()=>{
  let ok=false;const ids=[];
  const s=setup(async(_u,o)=>{ids.push(JSON.parse(o.body).id);if(!ok)throw Error('offline');return {ok:true,json:async()=>({ok:true})};});
  s.run("salvarEventoPendenteQrStack({id:'dish-1',event_type:'dish_observe',timestamp:'2026-11-10T12:00:00Z'})");
  await s.run('processarFilaAcessosQrStack()');assert.equal(s.run('lerFilaAcessosQrStack().length'),1);
  ok=true;await s.run('processarFilaAcessosQrStack()');assert.equal(s.run('lerFilaAcessosQrStack().length'),0);assert.deepEqual(ids,['dish-1','dish-1']);
});
test('acknowledging an older event does not remove an event added in flight',async()=>{
  let s;s=setup(async()=>{s.run("salvarEventoPendenteQrStack({id:'new'})");return {ok:true,json:async()=>({ok:true})};});
  s.run("salvarEventoPendenteQrStack({id:'old'})");await s.run('processarFilaAcessosQrStack()');
  assert.deepEqual(JSON.parse(s.run('JSON.stringify(lerFilaAcessosQrStack().map(e=>e.id))')),['new']);
});
test('pending events have no arbitrary truncation and old queues survive migration',()=>{
  const s=setup(()=>{});s.storage.set('pending',JSON.stringify([{id:'legacy'}]));
  s.run("for(let i=0;i<600;i++)salvarEventoPendenteQrStack({id:'event-'+i})");
  assert.equal(s.run('lerFilaAcessosQrStack().length'),601);
  s.run("confirmarEventoPendenteQrStack('legacy')");assert.equal(s.run('lerFilaAcessosQrStack().length'),600);
});
test('Retry-After prevents immediate retry without deleting the event',async()=>{
  let calls=0;const s=setup(async()=>{calls++;return {ok:false,headers:{get:()=> '120'},json:async()=>({ok:false})};});
  s.run("salvarEventoPendenteQrStack({id:'limited'})");await s.run('processarFilaAcessosQrStack()');await s.run('processarFilaAcessosQrStack()');
  assert.equal(calls,1);assert.equal(s.run('lerFilaAcessosQrStack().length'),1);
});
test('visible dish duration emits a persisted observation with the actual dish',()=>{
  const out=[];const c=vm.createContext({Map,performance:{now:()=>4000},sessionStorage:{getItem:()=>null,setItem(){}},dadosPratoQrStack:()=>({dishKey:'cupim'}),obterSessaoQrStack:()=> 'session',QRSTACK_ANALYTICS_CLIENT:'amaro',payloadPratoQrStack:(type,card,extra)=>({type,...extra}),enviarPayloadQrStack:e=>out.push(e),window:{},lerResumoQrStack(){}});
  vm.runInContext('const pratoTempoVisivelQrStack=new Map();'+html.slice(html.indexOf('const finalizarTempoPratoQrStack='),html.indexOf('const finalizarTodosTemposPratoQrStack=')),c);
  vm.runInContext('const card={};pratoTempoVisivelQrStack.set(card,1000);finalizarTempoPratoQrStack(card)',c);
  assert.equal(out[0].type,'dish_observe');assert.equal(out[0].duration_ms,3000);
});
