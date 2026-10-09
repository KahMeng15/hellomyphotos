#!/bin/bash
set -e

echo "=== Setup ==="
mkdir -p volumes/media_ro/folder_a
touch volumes/media_ro/folder_a/mock_image.jpg
sleep 1 # Ensure mtime is set

echo "=== Run Initial Scan ==="
docker exec hellomyphotos-backend-1 npx tsx src/test_full.ts

echo "=== Simulating User Rename on Host ==="
mv volumes/media_ro/folder_a volumes/media_ro/folder_b

echo "=== Run Second Scan ==="
cat << 'TS' > backend/src/test_full2.ts
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
TS
docker exec hellomyphotos-backend-1 npx tsx src/test_full2.ts

echo "=== Cleanup ==="
rm -rf volumes/media_ro/folder_b
docker exec hellomyphotos-backend-1 node -e "const {query} = require('./src/config/db'); query(\"DELETE FROM shared_folders WHERE folder_path IN ('folder_a', 'folder_b')\"); query(\"DELETE FROM media_files WHERE folder_path IN ('folder_a', 'folder_b')\"); process.exit(0);"
