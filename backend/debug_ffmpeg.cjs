const { execSync } = require('child_process');
const fs = require('fs');

console.log('--- FFMPEG VERSION ---');
try {
  console.log(execSync('ffmpeg -version').toString());
} catch (e) {
  console.error(e.message);
}

const testFile = '../volumes/media_ro/RSC/2022/Sem3 Junior Media/Jr ICT lesson/JR2/IMG_1151.HEIC';

console.log('\n--- FILE STATS ---');
try {
  const stats = fs.statSync(testFile);
  console.log(`Size: ${stats.size} bytes`);
} catch (e) {
  console.error(`File not found: ${testFile}`);
}

console.log('\n--- FFMPEG PROBE ---');
try {
  // Run ffmpeg with verbose output to see exactly why it says "Invalid data found"
  const output = execSync(`ffmpeg -v trace -i "${testFile}" -f null - 2>&1`);
  console.log(output.toString());
} catch (e) {
  console.log('FFMPEG exited with error. Output:');
  console.log(e.stdout ? e.stdout.toString() : '');
}
