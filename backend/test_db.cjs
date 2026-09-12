const { Pool } = require('pg');
const pool = new Pool({
  host: '127.0.0.1',
  port: 8002,
  user: 'hellomyphotos',
  password: 'hellomyphotos_secret',
  database: 'hellomyphotos'
});
async function check() {
  try {
    const res = await pool.query("SELECT COUNT(*) FROM media_files WHERE folder_path = 'PUBMED/Day 1/Photos'");
    console.log('Files in PUBMED/Day 1/Photos:', res.rows[0].count);
    const res2 = await pool.query("SELECT folder_path, COUNT(*) FROM media_files WHERE folder_path LIKE 'PUBMED%' GROUP BY folder_path");
    console.log('Other PUBMED folders:', res2.rows);
  } catch (e) {
    console.error(e.message);
  } finally {
    pool.end();
  }
}
check();
