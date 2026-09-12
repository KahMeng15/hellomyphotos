const sharp = require('sharp');
const fs = require('fs');

async function test(file) {
    try {
        console.log(`Testing Buffer decode: ${file}`);
        let buf = await fs.promises.readFile(file);
        let out = await sharp(buf, { unlimited: true }).resize(100, 100).toBuffer();
        console.log(`  Buffer OK`);
    } catch (e) {
        console.error(`  Buffer Failed: ${e.message}`);
    }

    try {
        console.log(`Testing Path decode: ${file}`);
        let out = await sharp(file, { unlimited: true }).resize(100, 100).toBuffer();
        console.log(`  Path OK`);
    } catch (e) {
        console.error(`  Path Failed: ${e.message}`);
    }
}

async function run() {
    await test('../volumes/media_ro/PUBMED/Day 2/Photos/IMG_8861.HEIC');
}

run();
