const fs = require('fs');
let content = fs.readFileSync('frontend/src/lib/components/Lightbox.svelte', 'utf8');

// Update mediaW and mediaH to fallback to media.img_width
content = content.replace(
  'const mediaW = $derived(media.exif_json?.ExifImageWidth || media.exif_json?.ImageWidth || media.exif_json?.width || 0);',
  'const mediaW = $derived(media.exif_json?.ExifImageWidth || media.exif_json?.ImageWidth || media.exif_json?.width || media.img_width || 0);'
);
content = content.replace(
  'const mediaH = $derived(media.exif_json?.ExifImageHeight || media.exif_json?.ImageHeight || media.exif_json?.height || 0);',
  'const mediaH = $derived(media.exif_json?.ExifImageHeight || media.exif_json?.ImageHeight || media.exif_json?.height || media.img_height || 0);'
);

// Format exposure time properly
content = content.replace(
  '{media.exif_json?.exposureTime ? `1/${Math.round(1/media.exif_json.exposureTime)}s ` : \'\'}',
  '{media.exif_json?.exposureTime ? (typeof media.exif_json.exposureTime === "number" && media.exif_json.exposureTime < 1 ? `1/${Math.round(1/media.exif_json.exposureTime)}s ` : `${media.exif_json.exposureTime}s `) : \'\'}'
);

fs.writeFileSync('frontend/src/lib/components/Lightbox.svelte', content, 'utf8');
