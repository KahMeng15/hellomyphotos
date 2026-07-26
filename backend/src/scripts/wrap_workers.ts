import fs from 'fs';
import path from 'path';

const queueDir = path.join(process.cwd(), 'backend/src/queue');
const files = fs.readdirSync(queueDir).filter(f => f.endsWith('Queue.ts'));

for (const file of files) {
  const filePath = path.join(queueDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');

  // Replace "export const <name>Worker = new Worker(" with 
  // "export let <name>Worker: Worker | undefined; if (process.env.IS_WORKER === 'true') { <name>Worker = new Worker("
  content = content.replace(/export const (\w+)Worker = new Worker\(/g, 
    "export let $1Worker: Worker | undefined;\nif (process.env.IS_WORKER === 'true') {\n  $1Worker = new Worker(");

  // Then replace the trailing "});\n\n<name>Worker.on(" with closing the if block and starting the on handlers
  content = content.replace(/(\}\);?)\n+?(\w+)Worker\.on\(/g, "$1\n\n  $2Worker.on(");

  // We need to close the if block at the very end of the file.
  // A simple way is to just append a closing brace if we inserted an opening one.
  if (content.includes("process.env.IS_WORKER === 'true'")) {
    content += "\n}\n";
  }

  fs.writeFileSync(filePath, content);
}
console.log('Modified 7 queue files');
