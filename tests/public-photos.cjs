const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('docs/index.html','utf8');
const images=[...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(m=>({getAttribute:()=>m[1]}));
const source=html.slice(html.indexOf('const chaveImagemPublica='),html.indexOf('const obterImagemPrato='));
const ctx=vm.createContext({URL,location:{href:'https://btcsolucoes.github.io/carda-pio/',origin:'https://btcsolucoes.github.io'},qrstackPlatformEndpoint:'https://qrstack-api.qrstack.workers.dev',document:{querySelectorAll:()=>images}});
vm.runInContext(source,ctx);
const allow=value=>vm.runInContext('imagemPublicaPermitida('+JSON.stringify(value)+')',ctx);
test('retired catalog images cannot reappear',()=>{
  for(const name of ['Galinhada Amaro','Lasanha de cupim','Picadinho carioca','Risoto de camarão','Pudim','Amaro','Café Expresso','Capuccino','Chocolate Quente','Pastéis de charque com queijo'])
    assert.equal(allow('fotos%20de%20pratos/'+encodeURIComponent(name)+'.png'),'');
});
test('approved restaurant photo survives',()=>{
  const url='fotos%20de%20pratos/Arroz%20de%20Polvo.jpg';assert.equal(allow(url),url);
});
test('new restaurant uploads survive without changing static HTML',()=>{
  const url='https://qrstack-api.qrstack.workers.dev/?action=getCatalogImage&key=catalog%2Famaro%2Fnew-upload.webp';assert.equal(allow(url),url);
});
test('unknown images and other tenant uploads stay hidden',()=>{
  assert.equal(allow('https://example.com/ai.png'),'');
  assert.equal(allow('https://qrstack-api.qrstack.workers.dev/?action=getCatalogImage&key=catalog%2Fother%2Fnew.webp'),'');
});
test('catalog rendering applies the public image policy',()=>{
  assert.ok(html.includes('const imagem=imagemPublicaPermitida(item.image_url);'));
  assert.ok(html.includes("const obterImagemPrato=nome=>imagemPublicaPermitida(fotosPratos[normalizarNome(nome)]||'');"));
});
