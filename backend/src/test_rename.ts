import { ScannerService } from './modules/scanner/scanner.service';
import { query } from './config/db';
import fs from 'fs';

async function run() {
  await query('SELECT 1'); // init db
  console.log("Initial scan...");
  await ScannerService.scanDirectory('test_rename');
  
  let res = await query('SELECT file_name, file_identifier, folder_path FROM media_files WHERE folder_path = $1', ['test_rename']);
  console.log("After initial scan:", res.rows);

  console.log("Renaming file...");
  fs.renameSync('/app/media/test_rename/a.jpg', '/app/media/test_rename/b.jpg');
  
  console.log("Second scan...");
  await ScannerService.scanDirectory('test_rename');
  
  res = await query('SELECT file_name, file_identifier, folder_path FROM media_files WHERE folder_path = $1', ['test_rename']);
  console.log("After rename scan:", res.rows);
  
  process.exit(0);
}
run();
