import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

const searchDir = '/app/media/PUBMED';

function findHeicFiles(dir: string, fileList: string[] = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      findHeicFiles(filePath, fileList);
    } else if (filePath.toLowerCase().endsWith('.heic') || filePath.toLowerCase().endsWith('.heif')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const heicFiles = findHeicFiles(searchDir);

// Test on a subset for speed, e.g., 20 files
const testSubset = heicFiles.slice(0, 20);
console.log(`Testing timing on ${testSubset.length} HEIC files...`);

let totalTimeMs = 0;
let successCount = 0;

async function testFile(file: string) {
  const tmpPpmPath = `/tmp/test_decode_${Date.now()}.ppm`;
  const startTime = Date.now();
  return new Promise<void>((resolve) => {
    execFile('heic-primary-decode', [file, tmpPpmPath], (error) => {
      const endTime = Date.now();
      const elapsed = endTime - startTime;
      if (!error) {
        totalTimeMs += elapsed;
        successCount++;
        if (fs.existsSync(tmpPpmPath)) fs.unlinkSync(tmpPpmPath);
        console.log(`Decoded in ${elapsed} ms: ${file}`);
      }
      resolve();
    });
  });
}

async function runTests() {
  for (const file of testSubset) {
    await testFile(file);
  }
  console.log('---');
  console.log(`Successfully processed: ${successCount} files`);
  console.log(`Total time: ${totalTimeMs} ms`);
  console.log(`Average time per image: ${(totalTimeMs / successCount / 1000).toFixed(3)} seconds`);
  process.exit(0);
}

runTests();
