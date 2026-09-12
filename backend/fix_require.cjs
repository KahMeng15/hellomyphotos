const fs = require('fs');
const file = 'backend/src/modules/media/media.service.ts';
let content = fs.readFileSync(file, 'utf8');

if (!content.includes("import { execFile } from 'child_process';")) {
  content = content.replace("import fs from 'fs';", "import fs from 'fs';\nimport { execFile } from 'child_process';");
}

fs.writeFileSync(file, content);
