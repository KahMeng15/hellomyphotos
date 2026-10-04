import { Client } from 'pg';
import { MetadataService } from './src/modules/media/metadata.service';
import * as path from 'path';

const client = new Client({ connectionString: 'postgresql://hellomyphotos:hellomyphotos_secret@postgres:5432/hellomyphotos' });

async function run() {
  await client.connect();
  const res = await client.query(`SELECT id, folder_path, file_name, mime_type FROM media_files WHERE file_name LIKE '%DSC08282.jpg%'`);
  const file = res.rows[0];
  const fullPath = path.resolve('/app/media', file.folder_path, file.file_name);
  
  const exif = await MetadataService.extractMetadata(file.id, fullPath, file.mime_type);
  await client.query('UPDATE media_files SET exif_json = $1 WHERE id = $2', [JSON.stringify(exif), file.id]);
  
  console.log('Updated EXIF:', exif);
  await client.end();
}
run().catch(console.error);
