const fs = require('fs');
let content = fs.readFileSync('frontend/src/lib/components/Lightbox.svelte', 'utf8');

content = content.replace(/\{@const d = getRawDate\(media\)\}/g, '');
content = content.replace(/d\.getTime/g, 'rawDate.getTime');
content = content.replace(/d\.toLocale/g, 'rawDate.toLocale');

content = content.replace(/\{@const w = media.exif_json\?\.ExifImageWidth \|\| media.exif_json\?\.ImageWidth \|\| media.exif_json\?\.width \|\| 0\}/, '');
content = content.replace(/\{@const h = media.exif_json\?\.ExifImageHeight \|\| media.exif_json\?\.ImageHeight \|\| media.exif_json\?\.height \|\| 0\}/, '');
content = content.replace(/\{@const mp = w && h \? Math\.round\(\(w \* h\) \/ 1000000\) : 0\}/, '');

content = content.replace(/\{mp > 0 \? \`\$\{mp\} MP \` : ''\}\{w > 0 && h > 0 \? \`\$\{w\}x\$\{h\} \` : ''\}/, `{mediaMP > 0 ? \`\${mediaMP} MP \` : ''}{mediaW > 0 && mediaH > 0 ? \`\${mediaW}x\${mediaH} \` : ''}`);

fs.writeFileSync('frontend/src/lib/components/Lightbox.svelte', content, 'utf8');
