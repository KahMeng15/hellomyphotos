import { query } from './src/config/db';
async function run() {
  const res = await query("SELECT COUNT(*) FROM media_files WHERE folder_path = 'PUBMED/Day 1/Photos'");
  console.log('Files in PUBMED/Day 1/Photos:', res.rows[0].count);
  const res2 = await query("SELECT folder_path, COUNT(*) FROM media_files WHERE folder_path LIKE 'PUBMED%' GROUP BY folder_path");
  console.log('Other PUBMED folders:', res2.rows);
  process.exit(0);
}
run();
