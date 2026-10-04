const fs = require('fs');
const path = 'src/config/db.ts';
let content = fs.readFileSync(path, 'utf8');

const regex = /`ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+) (.*?)`/g;

content = content.replace(regex, (match, table, column, def) => {
  return `\`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='${table}' AND column_name='${column}') THEN ALTER TABLE ${table} ADD COLUMN ${column} ${def}; END IF; END $$;\``;
});

fs.writeFileSync(path, content, 'utf8');
