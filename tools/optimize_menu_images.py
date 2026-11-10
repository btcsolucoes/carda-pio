"""Build responsive derivatives of only the approved photos in the public HTML."""
from pathlib import Path
from urllib.parse import unquote, urlsplit
import hashlib
import json
import re
from PIL import Image, ImageOps

root = Path(__file__).resolve().parents[1]
page = (root / 'index.html').read_text(encoding='utf-8')
manifest = {}
original_bytes = output_bytes = 0
for source in sorted(set(re.findall(r'<img[^>]+src="(fotos[^\"]+)"', page))):
    relative = unquote(urlsplit(source).path)
    path = root / 'docs' / relative
    if not path.is_file():
        raise ValueError('Missing approved image: ' + relative)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    variants = []
    with Image.open(path) as raw:
        photo = ImageOps.exif_transpose(raw).convert('RGB')
        for width in sorted({min(photo.width, target) for target in (400, 800, 1200)}):
            resized = photo.resize((width, round(photo.height * width / photo.width)), Image.Resampling.LANCZOS)
            target = f'assets/menu-images/{digest}-{width}.webp'
            for base in (root, root / 'docs'):
                (base / target).parent.mkdir(parents=True, exist_ok=True)
                resized.save(base / target, format='WEBP', quality=78, method=6)
            variants.append(f'{target} {width}w')
        original_bytes += path.stat().st_size
        output_bytes += (root / target).stat().st_size
        manifest[relative] = {'srcset': ', '.join(variants), 'width': photo.width, 'height': photo.height}
manifest_text = json.dumps(manifest, ensure_ascii=False, separators=(',', ':'))
helper = '''const fotosResponsivas=MANIFEST;
const dadosFotoResponsiva=valor=>{try{return fotosResponsivas[decodeURIComponent(new URL(valor,location.href).pathname).split('/carda-pio/').pop()]||fotosResponsivas[decodeURIComponent(String(valor).split('?')[0])];}catch{return null;}};
const aplicarFotoResponsiva=(img,valor)=>{const foto=dadosFotoResponsiva(valor);img.decoding='async';if(foto){img.srcset=foto.srcset;img.sizes='(max-width: 600px) calc(100vw - 44px), (max-width: 960px) 45vw, 300px';img.width=foto.width;img.height=foto.height;}else{img.removeAttribute('srcset');img.removeAttribute('sizes');}img.src=valor;};
'''.replace('MANIFEST', manifest_text)
if 'const fotosResponsivas=' not in page:
    page = page.replace('const obterImagemPrato=', helper + 'const obterImagemPrato=', 1)
else:
    page = re.sub(r'const fotosResponsivas=.*?;\nconst dadosFotoResponsiva=', 'const fotosResponsivas='+manifest_text+';\nconst dadosFotoResponsiva=', page, count=1)
def attributes(match):
    tag = match[0]
    src = re.search(r'src="([^"]+)"', tag)[1]
    photo = manifest.get(unquote(urlsplit(src).path))
    if not photo:
        return tag
    tag = re.sub(r'\s(?:srcset|sizes|decoding|width|height)="[^"]*"', '', tag)
    return tag[:-1] + f' srcset="{photo["srcset"]}" sizes="(max-width: 600px) calc(100vw - 44px), (max-width: 960px) 45vw, 300px" decoding="async" width="{photo["width"]}" height="{photo["height"]}">'
page = re.sub(r'<img\s[^>]*src="fotos[^>]*>', attributes, page)
page = page.replace("media.querySelector('img').src=imagem;", "aplicarFotoResponsiva(media.querySelector('img'),imagem);")
page = page.replace("almocoHojeLista.querySelectorAll('.fi').forEach(el=>io.observe(el));", "almocoHojeLista.querySelectorAll('img').forEach(img=>aplicarFotoResponsiva(img,img.getAttribute('src')));almocoHojeLista.querySelectorAll('.fi').forEach(el=>io.observe(el));")
for target in (root / 'index.html', root / 'docs/index.html'):
    target.write_text(page, encoding='utf-8')
print(json.dumps({'photos':len(manifest),'original_bytes':original_bytes,'largest_derivatives_bytes':output_bytes}))
