const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://hellomyphotos:hellomyphotos_secret@localhost:5432/hellomyphotos' });
async function run() {
  await client.connect();
  const res = await client.query(`SELECT exif_json FROM media_files WHERE file_name = 'KMLRC-20250215-204007-DSC08282.jpg'`);
  console.log(JSON.stringify(res.rows[0]?.exif_json, null, 2));
  await client.end();
}
run();
