const fs = require('fs');
async function test() {
  const stat = await fs.promises.stat('package.json');
  console.log(stat.ino, stat.size, stat.mtimeMs);
}
test();
