import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

const testFile = '/app/media/PUBMED/Day 1/Photos/IMG_0419.HEIC';
const tmpPpmPath = '/tmp/out_test.ppm';

console.log('Testing heic-primary-decode on', testFile);

if (!fs.existsSync(testFile)) {
  console.error('File not found:', testFile);
  process.exit(1);
}

execFile('heic-primary-decode', [testFile, tmpPpmPath], (error) => {
  if (error) {
    console.error('primary HEIC decode failed:', error.message);
    process.exit(1);
  } else {
    console.log('Success! Created', tmpPpmPath);
    if (fs.existsSync(tmpPpmPath)) {
      const stats = fs.statSync(tmpPpmPath);
      console.log(`PPM file size: ${stats.size} bytes`);
    } else {
      console.log('PPM file missing!');
    }
    process.exit(0);
  }
});
