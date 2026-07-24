import fs from 'fs';
import path from 'path';
import { query } from '../../config/db';
import { mediaQueue } from '../../queue/mediaQueue';

const MEDIA_ROOT = process.env.MEDIA_ROOT || '/app/media';
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime']);

export class ScannerService {
  static async scanAllDirectories(basePath = '') {
    const fullPath = path.join(MEDIA_ROOT, basePath);
    try {
      const files = await fs.promises.readdir(fullPath, { withFileTypes: true });
      await this.scanDirectory(basePath);
      
      for (const file of files) {
        if (file.isDirectory() && !file.name.startsWith('.')) {
          await this.scanAllDirectories(path.join(basePath, file.name));
        }
      }
    } catch (err: any) {
      console.error(`Error scanning all directories at ${fullPath}:`, err.message);
    }
  }

  static async scanDirectory(folderPath: string) {
    const fullPath = path.join(MEDIA_ROOT, folderPath);
    console.log(`Scanning: ${fullPath}`);

    try {
      const files = await fs.promises.readdir(fullPath, { withFileTypes: true });
      const currentFilesOnDisk: string[] = [];

      for (const file of files) {
        if (file.isSymbolicLink()) {
          console.warn(`Skipping symbolic link: ${file.name}`);
          continue;
        }

        if (file.isFile()) {
          const ext = path.extname(file.name).toLowerCase();
          // Basic extension mapping, a real app would use 'file-type' package or similar
          let mimeType = 'application/octet-stream';
          if (['.jpg', '.jpeg'].includes(ext)) mimeType = 'image/jpeg';
          if (ext === '.png') mimeType = 'image/png';
          if (ext === '.webp') mimeType = 'image/webp';
          if (ext === '.heic') mimeType = 'image/heic';
          if (ext === '.mp4') mimeType = 'video/mp4';
          if (ext === '.mov') mimeType = 'video/quicktime';

          if (ALLOWED_MIME_TYPES.has(mimeType)) {
            const stat = await fs.promises.stat(path.join(fullPath, file.name));
            currentFilesOnDisk.push(file.name);

            // Upsert file into DB, returning the record ID
            const result = await query(`
              INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (folder_path, file_name) DO UPDATE 
              SET size_bytes = EXCLUDED.size_bytes, updated_at = NOW()
              RETURNING id, xmax
            `, [folderPath, file.name, mimeType, stat.size]);

            // If this was an INSERT (xmax is 0), push a job to generate previews
            if (result.rows.length > 0 && result.rows[0].xmax == 0) {
              await mediaQueue.add('process-media', { 
                mediaId: result.rows[0].id, 
                fullPath: path.join(fullPath, file.name),
                mimeType 
              });
            }
          }
        } else if (file.isDirectory()) {
          // Future: optional recursive scan
        }
      }

      // Garbage Collection: Delete files that no longer exist on disk
      if (currentFilesOnDisk.length > 0) {
        await query(`
          DELETE FROM media_files 
          WHERE folder_path = $1 AND file_name != ALL($2::text[])
        `, [folderPath, currentFilesOnDisk]);
      } else {
        await query(`DELETE FROM media_files WHERE folder_path = $1`, [folderPath]);
      }

    } catch (err: any) {
      console.error(`Error scanning directory ${fullPath}:`, err.message);
    }
  }
}
