import { ScannerService } from './modules/scanner/scanner.service';
import { query } from './config/db';

async function run() {
  await query('SELECT 1');
  await ScannerService.scanDirectory('folder_b');
  
  let files = await query(`SELECT folder_path, file_name, file_identifier FROM media_files WHERE folder_path = 'folder_b'`);
  console.log("Files in DB after 2nd scan:", files.rows);
  
  let shares = await query(`SELECT folder_path, share_token FROM shared_folders WHERE folder_path = 'folder_b'`);
  console.log("Shared links healed to point to new folder:", shares.rows);
  
  process.exit(0);
}
run();
