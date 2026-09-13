const { execSync } = require('child_process');
const fs = require('fs');

const ppmPath = '/tmp/test_decode.ppm';
fs.writeFileSync(ppmPath, Buffer.from("P6\n2 2\n255\n\xff\x00\x00\x00\xff\x00\x00\x00\xff\xff\xff\xff", "binary"));
execSync(`ffmpeg -y -i ${ppmPath} /tmp/test_decode.png`);
console.log(fs.statSync('/tmp/test_decode.png').size);
