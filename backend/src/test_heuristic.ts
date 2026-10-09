import { ScannerService } from './modules/scanner/scanner.service';
import { query } from './config/db';

async function run() {
  await query('SELECT 1'); // init db
  
  // Set up dummy share
  await query("INSERT INTO shared_folders (folder_path, share_token) VALUES ('test_rename_2', 'testtoken123') ON CONFLICT DO NOTHING");

  console.log("First scan test_rename_2...");
  await ScannerService.scanDirectory('test_rename_2');
  
  let res = await query('SELECT folder_path FROM shared_folders WHERE share_token = $1', ['test_rename_2']);
  
  console.log("Renaming on host...");
}
run();
