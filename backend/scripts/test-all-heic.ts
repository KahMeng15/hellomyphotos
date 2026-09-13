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
console.log(`Found ${heicFiles.length} HEIC files in ${searchDir}`);

let successCount = 0;
let failCount = 0;

async function testFile(file: string) {
  const tmpPpmPath = `/tmp/test_decode_${Date.now()}.ppm`;
  return new Promise<void>((resolve) => {
    execFile('heic-primary-decode', [file, tmpPpmPath], (error) => {
      if (error) {
        console.error(`❌ Failed: ${file} - ${error.message}`);
        failCount++;
      } else {
        // Check if PPM is generated
        if (fs.existsSync(tmpPpmPath)) {
          const size = fs.statSync(tmpPpmPath).size;
          if (size > 1024) { // More than 1KB
            console.log(`✅ Success: ${file} (PPM size: ${(size / 1024 / 1024).toFixed(2)} MB)`);
            successCount++;
            fs.unlinkSync(tmpPpmPath);
          } else {
            console.error(`❌ Failed: ${file} - PPM file too small`);
            failCount++;
          }
        } else {
          console.error(`❌ Failed: ${file} - PPM file not created`);
          failCount++;
        }
      }
      resolve();
    });
  });
}

async function runTests() {
  for (const file of heicFiles) {
    await testFile(file);
  }
  console.log('---');
  console.log(`Total: ${heicFiles.length}`);
  console.log(`Success: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  process.exit(0);
}

runTests();
