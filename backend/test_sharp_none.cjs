const sharp = require('sharp');

async function test() {
  const file = '../volumes/media_ro/PUBMED/Day 1/Photos/IMG_0699.HEIC';
  console.log('Testing failOn: none on', file);
  try {
    await sharp(file, { unlimited: true, failOn: 'none' })
      .resize(100, 100)
      .toFile('test_none.jpg');
    console.log('Success with failOn: none');
  } catch (e) {
    console.log('Failed:', e.message);
  }
}
test();
