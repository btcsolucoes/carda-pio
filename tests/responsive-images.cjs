const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('docs/index.html','utf8');
test('all responsive photo derivatives exist and match the root mirror',()=>{
  const sets=[...html.matchAll(/srcset="(assets\/menu-images\/[^\"]+)"/g)];
  assert.equal(sets.length,37);
  for(const [_,srcset] of sets) for(const variant of srcset.split(', ')) {
    const [file,width]=variant.split(' ');
    assert.match(width,/^\d+w$/);
    assert.ok(fs.statSync('docs/'+file).size>0);
    assert.equal(fs.readFileSync(file).compare(fs.readFileSync('docs/'+file)),0);
  }
});
test('changing a catalog image removes stale responsive sources',()=>{
  const start=html.indexOf('const fotosResponsivas=');
  const end=html.indexOf('const obterImagemPrato=',start);
  const context=vm.createContext({URL,location:{href:'https://btcsolucoes.github.io/carda-pio/'}});
  vm.runInContext(html.slice(start,end),context);
  const img={removeAttribute(k){delete this[k];}};
  context.img=img;
  vm.runInContext("aplicarFotoResponsiva(img,'fotos%20de%20pratos/Arroz%20de%20Polvo.jpg')",context);
  assert.match(img.srcset,/menu-images/);
  vm.runInContext("aplicarFotoResponsiva(img,'https://qrstack-api.qrstack.workers.dev/?action=getCatalogImage&key=catalog%2Famaro%2Fnew.webp')",context);
  assert.equal(img.srcset,undefined);
  assert.match(img.src,/new.webp/);
});
test('catalog requests reuse HTTP caching instead of random JSONP URLs',()=>{
  const code=html.slice(html.indexOf('const obterCatalogoQrStack='),html.indexOf('const sincronizarCatalogoQrStack='));
  assert.ok(code.includes('fetch(url'));
  assert.ok(!code.includes('Date.now'));
  assert.ok(!code.includes('callback'));
});
