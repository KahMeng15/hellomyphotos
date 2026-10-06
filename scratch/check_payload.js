const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'hellomyphotos',
  password: process.env.DB_PASS || 'hellomyphotos_secret',
  database: process.env.DB_NAME || 'hellomyphotos',
});

async function run() {
  const res = await pool.query(`SELECT file_name, length(exif_json::text) as exif_len, length(clip_embedding::text) as clip_len FROM media_files LIMIT 10`);
  console.log(res.rows);
  
  const sumRes = await pool.query(`SELECT folder_path, COUNT(*), SUM(length(exif_json::text)) as total_exif_len, SUM(length(clip_embedding::text)) as total_clip_len FROM media_files GROUP BY folder_path LIMIT 5`);
  console.log(sumRes.rows);
  
  process.exit(0);
}
run();
