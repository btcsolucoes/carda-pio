"""Apply bounded, freshness-preserving menu loading improvements to both copies."""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
page=(root/'index.html').read_text(encoding='utf-8')
early='''<link rel="preconnect" href="https://qrstack-api.qrstack.workers.dev" crossorigin>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<script>
// Start today's public data before font loading and HTML parsing finish.
window.qrstackMenuDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());
window.qrstackMenuLoad=fetch('https://qrstack-api.qrstack.workers.dev/?action=getMenu&slug=amaro&date='+window.qrstackMenuDate,{signal:AbortSignal.timeout(8000)})
  .then(response=>response.ok?response.json():null).catch(()=>null);
</script>
'''
if 'window.qrstackMenuLoad=' not in page:
    page=page.replace('<link href="https://fonts.googleapis.com',early+'<link href="https://fonts.googleapis.com',1)
page=re.sub(r'const hojeIso=\(\)=>\{const d=new Date\(\);.*?return `\$\{y\}-\$\{m\}-\$\{day\}`;\};',"const hojeIso=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());",page,count=1)
start=page.index('const obterCatalogoQrStack=')
end=page.index('const sincronizarCatalogoQrStack=',start)
page=page[:start]+'''const obterCatalogoQrStack=async()=>{
  const url=new URL(qrstackPlatformEndpoint);url.searchParams.set('action','getCatalog');url.searchParams.set('slug','amaro');
  const response=await fetch(url,{signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error('catalog_request_failed');
  const data=await response.json();if(data?.ok!==true)throw new Error('catalog_invalid_payload');return data;
};
'''+page[end:]
page=page.replace("fetch(url,{cache:'no-store',signal:controller.signal})", "fetch(url,{signal:controller.signal})")
page=page.replace('const data=await obterJson(url,8000);', "const data=typeof window!=='undefined'&&window.qrstackMenuDate===hojeIso()&&window.qrstackMenuLoad?await window.qrstackMenuLoad:await obterJson(url,8000);")
page=page.replace('.fi.in{opacity:1;transform:translateY(0);}', '.fi.in{opacity:1;transform:translateY(0);}\n.hero .fi{opacity:1;transform:none;transition:none;}')
for target in (root/'index.html',root/'docs/index.html'):
    target.write_text(page,encoding='utf-8')
