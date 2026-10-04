const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://hellomyphotos:hellomyphotos_secret@localhost:5432/hellomyphotos' });
async function run() {
  await client.connect();
  const res = await client.query('SELECT folder_path, cover_media_id, auto_cover_media_id FROM folder_settings LIMIT 5;');
  console.log('Folder settings:', res.rows);
  const mediaRes = await client.query('SELECT id, folder_path FROM media_files LIMIT 5;');
  console.log('Media:', mediaRes.rows);
  await client.end();
}
run();
