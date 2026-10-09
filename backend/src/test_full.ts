import { ScannerService } from './modules/scanner/scanner.service';
import { query } from './config/db';
import crypto from 'crypto';

async function run() {
  await query('SELECT 1'); // Wait for DB pool
  const token = crypto.randomBytes(6).toString('hex');
  
  await query(`INSERT INTO shared_folders (folder_path, share_token) VALUES ('folder_a', $1)`, [token]);
  
  await ScannerService.scanDirectory('folder_a');
  
  let files = await query(`SELECT folder_path, file_name, file_identifier FROM media_files WHERE folder_path = 'folder_a'`);
  console.log("Files in DB after 1st scan:", files.rows);
  
  process.exit(0);
}
run();
