const fs = require('fs');
let content = fs.readFileSync('frontend/src/lib/components/Lightbox.svelte', 'utf8');

// Insert new derived variables for camera info
const newDerived = `
  const exifIso = $derived(media.exif_json?.iso || media.exif_json?.ISO || media.exif_json?.Iso);
  const exifMake = $derived(media.exif_json?.make || media.exif_json?.Make);
  const exifModel = $derived(media.exif_json?.model || media.exif_json?.Model);
  const exifLens = $derived(media.exif_json?.lensModel || media.exif_json?.LensModel);
  const exifFocal = $derived(media.exif_json?.focalLength || media.exif_json?.FocalLength);
  const exifAperture = $derived(media.exif_json?.fNumber || media.exif_json?.FNumber || media.exif_json?.aperture || media.exif_json?.ApertureValue);
  const exifShutter = $derived(media.exif_json?.exposureTime || media.exif_json?.ExposureTime);
`;

content = content.replace('const mediaMP = $derived(mediaW && mediaH ? Math.round((mediaW * mediaH) / 1000000) : 0);', 'const mediaMP = $derived(mediaW && mediaH ? Math.round((mediaW * mediaH) / 1000000) : 0);\n' + newDerived);

content = content.replace(/\{#if media\.exif_json\?\.make \|\| media\.exif_json\?\.model \|\| media\.exif_json\?\.iso \|\| media\.exif_json\?\.exposureTime\}/, '{#if exifMake || exifModel || exifIso || exifShutter}');
content = content.replace(/\{media\.exif_json\?\.make \|\| ''\} \{media\.exif_json\?\.model \|\| 'Unknown Camera'\}/, '{exifMake || \'\'} {exifModel || \'Unknown Camera\'}');
content = content.replace(/\{media\.exif_json\?\.exposureTime \? \(typeof media\.exif_json\.exposureTime === "number" && media\.exif_json\.exposureTime < 1 \? \`1\/\$\{Math\.round\(1\/media\.exif_json\.exposureTime\)\}s \` : \`\$\{media\.exif_json\.exposureTime\}s \`\) : ''\}/, '{exifShutter ? (typeof exifShutter === "number" && exifShutter < 1 ? `1/${Math.round(1/exifShutter)}s ` : `${exifShutter}s `) : \'\'}');
content = content.replace(/\{media\.exif_json\?\.iso \? \`ISO \$\{media\.exif_json\.iso\}\` : ''\}/, '{exifIso ? `ISO ${exifIso}` : \'\'}');

content = content.replace(/\{#if media\.exif_json\?\.lensModel \|\| media\.exif_json\?\.fNumber \|\| media\.exif_json\?\.focalLength\}/, '{#if exifLens || exifAperture || exifFocal}');
content = content.replace(/\{media\.exif_json\?\.lensModel \|\| 'Unknown Lens'\}/, '{exifLens || \'Unknown Lens\'}');
content = content.replace(/\{media\.exif_json\?\.fNumber \? \`f\/\$\{media\.exif_json\.fNumber\} \` : ''\}/, '{exifAperture ? `f/${exifAperture} ` : \'\'}');
content = content.replace(/\{media\.exif_json\?\.focalLength \? \`\$\{media\.exif_json\.focalLength\}mm\` : ''\}/, '{exifFocal ? `${exifFocal}mm` : \'\'}');

fs.writeFileSync('frontend/src/lib/components/Lightbox.svelte', content, 'utf8');
