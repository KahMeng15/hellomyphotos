const sharp = require('sharp');
const fs = require('fs');

async function test() {
  const file = '/tmp/test_decode.ppm';
  // create dummy ppm
  fs.writeFileSync(file, Buffer.from("P6\n1 1\n255\n\xff\x00\x00", "binary"));
  try {
    await sharp(file).metadata();
    console.log("Sharp supports PPM!");
  } catch(e) {
    console.error("Sharp failed:", e.message);
  }
}
test();
