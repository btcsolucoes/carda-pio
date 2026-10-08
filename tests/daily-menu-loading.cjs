const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('docs/index.html', 'utf8');
const source = html.slice(html.indexOf('let pratosHojeExibidos=[];'), html.indexOf('inicializarCardapioQrStack();'));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
const response = data => ({ok:true,json:async()=>data});
const platform = name => response({ok:true,menu:{date:'2026-10-08',is_published:1},items:[{name,price:38}]});
const tick = () => new Promise(resolve=>setImmediate(resolve));
function setup(fetch, catalog = async()=>{}) {
  const rendered=[], statuses=[], timers=new Map(); let id=0;
  const context=vm.createContext({URL,AbortController,fetch,
    setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;}, clearTimeout:key=>timers.delete(key),
    almocoHojeLista:{}, almocoHojeEndpoint:'https://sheets.example/', qrstackPlatformEndpoint:'https://api.example/',
    hojeIso:()=> '2026-10-08', prepararPratosHoje:rows=>rows.filter(r=>r.data==='2026-10-08'),
    renderPratosBonito:rows=>rendered.push(rows.map(r=>r.prato)),renderStatusBonito:s=>statuses.push(s),
    sincronizarCatalogoQrStack:catalog});
  vm.runInContext(source,context);
  return {context,rendered,statuses,timers,load:()=>vm.runInContext('carregarAlmocoHojeBonito()',context)};
}
test('fast platform renders without requesting Sheets',async()=>{
  let calls=0; const s=setup(async()=>{calls++;return platform('Cupim');});
  await s.load(); assert.equal(calls,1); assert.equal(s.rendered[0][0],'Cupim'); assert.equal(s.timers.size,0);
});
test('a stalled catalog does not block lunch',async()=>{
  const s=setup(async()=>platform('Bobo'),()=>new Promise(()=>{}));
  vm.runInContext('inicializarCardapioQrStack()',s.context);
  await tick(); assert.equal(s.rendered[0][0],'Bobo');
});
test('Sheets can render first; platform retains precedence',async()=>{
  const pending=deferred();
  const s=setup(async url=>String(url).includes('api.example')?pending.promise:response([{prato:'Forms',preco:38,data:'2026-10-08'}]));
  const done=s.load(); [...s.timers.values()].find(t=>t.ms===1500).fn();
  await tick(); assert.equal(s.rendered[0][0],'Forms');
  pending.resolve(platform('Painel')); await done;
  assert.equal(s.rendered.at(-1)[0],'Painel');
});
test('late Sheets never overwrites platform',async()=>{
  const p=deferred(),sheet=deferred();
  const s=setup(url=>String(url).includes('api.example')?p.promise:sheet.promise);
  const done=s.load(); [...s.timers.values()].find(t=>t.ms===1500).fn();
  p.resolve(platform('Painel')); await done;
  sheet.resolve(response([{prato:'Forms',data:'2026-10-08'}])); await tick();
  assert.equal(s.rendered.length,1); assert.equal(s.rendered[0][0],'Painel');
});
test('errors do not claim menu was not submitted',async()=>{
  const s=setup(async()=>{throw Error('offline');}); await s.load();
  assert.match(s.statuses[0],/Não foi possível atualizar/);
});
test('previous-day Sheets menu is not displayed',async()=>{
  const s=setup(async url=>String(url).includes('api.example')?response({ok:true,menu:null}):response([{prato:'Yesterday',data:'2026-10-07'}]));
  await s.load();assert.equal(s.rendered.length,0);assert.match(s.statuses[0],/ainda não informado/);
});
test('request timeout aborts the stalled platform and uses Sheets',async()=>{
  let aborted=false;
  const s=setup((url,{signal})=>String(url).includes('api.example')?new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('timeout'));})):Promise.resolve(response([{prato:'Forms',data:'2026-10-08'}])));
  const done=s.load();[...s.timers.values()].find(t=>t.ms===8000).fn();await done;
  assert.equal(aborted,true);assert.equal(s.rendered[0][0],'Forms');
});
test('published and root files stay identical',()=>assert.equal(fs.readFileSync('index.html','utf8'),html));
