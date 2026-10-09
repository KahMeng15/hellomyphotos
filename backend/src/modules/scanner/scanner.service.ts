import fs from 'fs';
import path from 'path';
import { query } from '../../config/db';
import { dispatchMediaFile } from '../../queue/dispatch';

const defaultMediaDir = fs.existsSync('/app/media') ? '/app/media' : path.resolve(process.cwd(), '../volumes/media_ro');
const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || defaultMediaDir);
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime']);

export class ScannerService {
  static async scanAllDirectories(basePath = '') {
    const fullPath = path.join(MEDIA_ROOT, basePath);
    try {
      const files = await fs.promises.readdir(fullPath, { withFileTypes: true });
      const { scannerQueue } = await import('../../queue/scannerQueue');
      // M-1 Fix: Use folderPath as jobId so duplicate scan jobs are deduplicated in BullMQ
      // Note: BullMQ custom job IDs cannot contain colons.
      const safeJobId = `scan_${basePath || 'root'}`.replace(/:/g, '_');
      await scannerQueue.add('scan-directory', { folderPath: basePath }, { jobId: safeJobId });
      
      for (const file of files) {
        if (file.isDirectory() && !file.name.startsWith('.')) {
          await this.scanAllDirectories(path.join(basePath, file.name));
        }
      }
    } catch (err: any) {
      console.error(`Error queuing all directories at ${fullPath}:`, err.message);
    }
  }

  static async scanDirectory(folderPath: string) {
    const fullPath = path.join(MEDIA_ROOT, folderPath);
    console.log(`Scanning: ${fullPath}`);

    try {
      // Invalidate the auto-cover cache for this folder so it can be recomputed after scan
      await query(`UPDATE folder_settings SET auto_cover_media_id = NULL WHERE folder_path = $1`, [folderPath]);

      let folderHealed = false;

      const files = await fs.promises.readdir(fullPath, { withFileTypes: true });
      const currentFilesOnDisk: string[] = [];
      // Track whether any directory entries were seen (even if all filtered out)
      let totalEntriesSeen = 0;

      for (const file of files) {
        totalEntriesSeen++;
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
            
            // Highly stable cross-platform signature (works on :ro Docker mounts unlike inodes)
            const fileIdentifier = `sz-${stat.size}-mt-${Math.floor(stat.mtimeMs)}`;

            // Folder Rename Heuristic & Self-Healing
            if (!folderHealed) {
              const oldRow = await query(`SELECT folder_path FROM media_files WHERE file_identifier = $1 LIMIT 1`, [fileIdentifier]);
              if (oldRow.rows.length > 0) {
                const oldFolder = oldRow.rows[0].folder_path;
                if (oldFolder && oldFolder !== folderPath) {
                  // The file moved from oldFolder to folderPath. Did the entire folder rename?
                  const oldFullPath = path.join(MEDIA_ROOT, oldFolder);
                  const oldFolderExists = await fs.promises.access(oldFullPath).then(() => true).catch(() => false);
                  
                  if (!oldFolderExists) {
                    console.log(`[Scanner] Detected folder rename from ${oldFolder} to ${folderPath}. Healing metadata...`);
                    await query(`UPDATE shared_folders SET folder_path = $1 WHERE folder_path = $2`, [folderPath, oldFolder]);
                    await query(`UPDATE folder_settings SET folder_path = $1 WHERE folder_path = $2`, [folderPath, oldFolder]);
                    // Update all files en masse to speed up the loop
                    await query(`UPDATE media_files SET folder_path = $1 WHERE folder_path = $2`, [folderPath, oldFolder]);
                  }
                }
              }
              folderHealed = true;
            }

            // Legacy Backfill: If the row exists but has no file_identifier, update it first.
            await query(`
              UPDATE media_files 
              SET file_identifier = $1 
              WHERE folder_path = $2 AND file_name = $3 AND file_identifier IS NULL
            `, [fileIdentifier, folderPath, file.name]);

            // Upsert file into DB based on stable file_identifier
            const result = await query(`
              INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes, file_identifier)
              VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (file_identifier) DO UPDATE 
              SET folder_path = EXCLUDED.folder_path, 
                  file_name = EXCLUDED.file_name,
                  size_bytes = EXCLUDED.size_bytes,
                  updated_at = NOW()
              RETURNING id, xmax, blurhash
            `, [folderPath, file.name, mimeType, stat.size, fileIdentifier]);

            // If this was an INSERT (xmax is 0) OR it failed processing previously (blurhash is null)
            if (result.rows.length > 0 && (result.rows[0].xmax == 0 || !result.rows[0].blurhash)) {
              await dispatchMediaFile({ 
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

      // Garbage Collection: Delete files that no longer exist on disk.
      // C-3 Fix: Only delete DB records when we KNOW the scan succeeded and saw
      // media files (or confirmed the directory is genuinely empty via totalEntriesSeen).
      // This prevents a transient I/O issue or NFS glitch (directory appears empty)
      // from mass-deleting all records for that folder.
      if (currentFilesOnDisk.length > 0) {
        // Normal case: delete DB records for files that are no longer on disk
        await query(`
          DELETE FROM media_files 
          WHERE folder_path = $1 AND file_name != ALL($2::text[])
        `, [folderPath, currentFilesOnDisk]);
      } else if (totalEntriesSeen > 0) {
        // Directory has entries (subdirs, hidden files, unsupported types) but no media:
        // safe to purge media records for this folder
        await query(`DELETE FROM media_files WHERE folder_path = $1`, [folderPath]);
      } else {
        // Directory appears completely empty (0 entries from readdir).
        // This could be a transient NFS/mount glitch — do NOT delete records.
        // We only clean up if the folder itself no longer exists on disk.
        const folderStillExists = await fs.promises.access(fullPath).then(() => true).catch(() => false);
        if (!folderStillExists) {
          console.log(`[Scanner] Folder ${fullPath} no longer exists, removing DB records.`);
          await query(`DELETE FROM media_files WHERE folder_path = $1`, [folderPath]);
        } else {
          console.warn(`[Scanner] Folder ${fullPath} appears empty (0 entries). Skipping GC to avoid data loss on transient mount issue.`);
        }
      }

    } catch (err: any) {
      console.error(`Error scanning directory ${fullPath}:`, err.message);
    }
  }
}
