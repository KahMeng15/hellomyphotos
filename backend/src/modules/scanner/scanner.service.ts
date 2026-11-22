import fs from 'fs';
import path from 'path';
import { query } from '../../config/db';
import { redis } from '../../config/redis';
import { dispatchMediaFile } from '../../queue/dispatch';
import { MEDIA_ROOT, STAGING_ROOT, resolveMediaFullPath } from '../../utils/mediaPath';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'video/mp4',
  'video/quicktime',
  'image/x-sony-arw',
  'image/x-canon-cr2',
  'image/x-canon-cr3',
  'image/x-nikon-nef',
  'image/x-adobe-dng',
  'image/x-fuji-raf',
  'image/x-panasonic-rw2',
  'image/x-olympus-orf',
  'image/x-pentax-pef'
]);

export class ScannerService {
  static async cleanupDeletedFolders() {
    try {
      // Safety Tip: Verify that MEDIA_ROOT or STAGING_ROOT exists and is readable before pruning
      await fs.promises.access(MEDIA_ROOT, fs.constants.R_OK);
      const rootEntries = await fs.promises.readdir(MEDIA_ROOT);
      if (rootEntries.length === 0) {
        const countRes = await query(`SELECT COUNT(*)::int as count FROM media_files`);
        if (countRes.rows[0]?.count > 0) {
          console.warn(`[Scanner GC] MEDIA_ROOT is empty but database contains ${countRes.rows[0].count} files. Mount might be disconnected. Aborting folder pruning.`);
          return;
        }
      }

      const result = await query(`
        SELECT DISTINCT folder_path 
        FROM (
          SELECT folder_path FROM media_files WHERE folder_path IS NOT NULL AND folder_path != ''
          UNION
          SELECT folder_path FROM folder_settings WHERE folder_path IS NOT NULL AND folder_path != ''
        ) f
      `);

      for (const row of result.rows) {
        const fullMedia = path.join(MEDIA_ROOT, row.folder_path);
        const fullStaging = path.join(STAGING_ROOT, row.folder_path);
        const exists = (await fs.promises.access(fullMedia).then(() => true).catch(() => false))
                    || (await fs.promises.access(fullStaging).then(() => true).catch(() => false));
        if (!exists) {
          console.log(`[Scanner GC] Pruning deleted folder from DB: ${row.folder_path}`);
          await query(`DELETE FROM media_files WHERE folder_path = $1`, [row.folder_path]);
          await query(`DELETE FROM folder_settings WHERE folder_path = $1`, [row.folder_path]);
          try {
            await redis.del(`folder_dirs_v2:${row.folder_path}`).catch(() => {});
            const parent = row.folder_path.includes('/') ? row.folder_path.substring(0, row.folder_path.lastIndexOf('/')) : '';
            await redis.del(`folder_dirs_v2:${parent}`).catch(() => {});
          } catch {}
        }
      }
    } catch (err: any) {
      console.error(`[Scanner GC] Error during deleted folders cleanup:`, err.message);
    }
  }

  static async scanAllDirectories(basePath = '') {
    if (basePath === '') {
      await this.cleanupDeletedFolders();
    }
    const mediaDir = path.join(MEDIA_ROOT, basePath);
    const stagingDir = path.join(STAGING_ROOT, basePath);
    const subdirs = new Set<string>();

    try {
      if (fs.existsSync(mediaDir)) {
        const files = await fs.promises.readdir(mediaDir, { withFileTypes: true });
        for (const file of files) {
          if (file.isDirectory() && !file.name.startsWith('.')) {
            subdirs.add(file.name);
          }
        }
      }
    } catch (err: any) {
      console.error(`Error reading media directory at ${mediaDir}:`, err.message);
    }

    try {
      if (fs.existsSync(stagingDir)) {
        const files = await fs.promises.readdir(stagingDir, { withFileTypes: true });
        for (const file of files) {
          if (file.isDirectory() && !file.name.startsWith('.')) {
            subdirs.add(file.name);
          }
        }
      }
    } catch (err: any) {
      console.error(`Error reading staging directory at ${stagingDir}:`, err.message);
    }

    const { scannerQueue } = await import('../../queue/scannerQueue');
    const safeJobId = `scan_${basePath || 'root'}`.replace(/:/g, '_');
    await scannerQueue.add('scan-directory', { folderPath: basePath }, { jobId: safeJobId });

    for (const sub of subdirs) {
      await this.scanAllDirectories(path.join(basePath, sub));
    }
  }

  static async scanDirectory(folderPath: string) {
    const mediaDir = path.join(MEDIA_ROOT, folderPath);
    const stagingDir = path.join(STAGING_ROOT, folderPath);
    const mediaExists = fs.existsSync(mediaDir);
    const stagingExists = fs.existsSync(stagingDir);

    console.log(`Scanning unified overlay: folder=${folderPath} mediaExists=${mediaExists} stagingExists=${stagingExists}`);

    try {
      // Invalidate the auto-cover cache for this folder so it can be recomputed after scan
      await query(`UPDATE folder_settings SET auto_cover_media_id = NULL WHERE folder_path = $1`, [folderPath]);

      let folderHealed = false;
      const fileMap = new Map<string, { fullPath: string; isStaged: boolean }>();
      let totalEntriesSeen = 0;

      // 1. Permanent media layer (non-staged)
      if (mediaExists) {
        try {
          const mFiles = await fs.promises.readdir(mediaDir, { withFileTypes: true });
          for (const f of mFiles) {
            totalEntriesSeen++;
            if (f.isFile() && !f.name.startsWith('.')) {
              fileMap.set(f.name, { fullPath: path.join(mediaDir, f.name), isStaged: false });
            }
          }
        } catch (err: any) {
          console.warn(`[Scanner] Error reading mediaDir ${mediaDir}:`, err.message);
        }
      }

      // 2. Staging layer (staged)
      if (stagingExists) {
        try {
          const sFiles = await fs.promises.readdir(stagingDir, { withFileTypes: true });
          for (const f of sFiles) {
            totalEntriesSeen++;
            if (f.isFile() && !f.name.startsWith('.')) {
              // If file is also in permanent media, media version takes precedence (promoted)
              if (!fileMap.has(f.name)) {
                fileMap.set(f.name, { fullPath: path.join(stagingDir, f.name), isStaged: true });
              }
            }
          }
        } catch (err: any) {
          console.warn(`[Scanner] Error reading stagingDir ${stagingDir}:`, err.message);
        }
      }

      const currentFilesOnDisk: string[] = [];

      for (const [fileName, fileInfo] of fileMap.entries()) {
        const ext = path.extname(fileName).toLowerCase();
        let mimeType = 'application/octet-stream';
        if (['.jpg', '.jpeg'].includes(ext)) mimeType = 'image/jpeg';
        if (ext === '.png') mimeType = 'image/png';
        if (ext === '.webp') mimeType = 'image/webp';
        if (ext === '.heic') mimeType = 'image/heic';
        if (ext === '.mp4') mimeType = 'video/mp4';
        if (ext === '.mov') mimeType = 'video/quicktime';
        if (['.arw', '.srf', '.sr2'].includes(ext)) mimeType = 'image/x-sony-arw';
        if (['.cr2', '.cr3'].includes(ext)) mimeType = 'image/x-canon-cr2';
        if (['.nef', '.nrw'].includes(ext)) mimeType = 'image/x-nikon-nef';
        if (ext === '.dng') mimeType = 'image/x-adobe-dng';
        if (ext === '.raf') mimeType = 'image/x-fuji-raf';
        if (ext === '.rw2') mimeType = 'image/x-panasonic-rw2';
        if (ext === '.orf') mimeType = 'image/x-olympus-orf';
        if (ext === '.pef') mimeType = 'image/x-pentax-pef';

        if (ALLOWED_MIME_TYPES.has(mimeType)) {
          try {
            const stat = await fs.promises.stat(fileInfo.fullPath);
            currentFilesOnDisk.push(fileName);

            const inoPart = stat.ino ? `ino-${stat.ino}-` : '';
            const fileIdentifier = `${inoPart}sz-${stat.size}-mt-${Math.floor(stat.mtimeMs)}`;

            // Folder Rename Heuristic & Self-Healing
            if (!folderHealed) {
              const oldRow = await query(`SELECT folder_path FROM media_files WHERE file_identifier = $1 LIMIT 1`, [fileIdentifier]);
              if (oldRow.rows.length > 0) {
                const oldFolder = oldRow.rows[0].folder_path;
                if (oldFolder && oldFolder !== folderPath) {
                  const oldFullMedia = path.join(MEDIA_ROOT, oldFolder);
                  const oldFullStaging = path.join(STAGING_ROOT, oldFolder);
                  const oldFolderExists = fs.existsSync(oldFullMedia) || fs.existsSync(oldFullStaging);

                  if (!oldFolderExists) {
                    console.log(`[Scanner] Detected folder rename from ${oldFolder} to ${folderPath}. Healing metadata...`);
                    await query(`UPDATE shared_folders SET folder_path = $1 WHERE folder_path = $2`, [folderPath, oldFolder]);
                    await query(`UPDATE folder_settings SET folder_path = $1 WHERE folder_path = $2`, [folderPath, oldFolder]);
                    await query(`UPDATE media_files SET folder_path = $1 WHERE folder_path = $2`, [folderPath, oldFolder]);
                  }
                }
              }
              folderHealed = true;
            }

            // Backfill / update file_identifier
            try {
              await query(`
                UPDATE media_files 
                SET file_identifier = $1 
                WHERE folder_path = $2 AND file_name = $3 AND (file_identifier IS NULL OR file_identifier != $1)
              `, [fileIdentifier, folderPath, fileName]);
            } catch (backfillErr: any) {
              // ignore duplicate constraint
            }

            // Upsert file into DB with unified is_staged flag
            const result = await query(`
              INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes, file_identifier, is_staged)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (file_identifier) DO UPDATE 
              SET folder_path = EXCLUDED.folder_path, 
                  file_name = EXCLUDED.file_name,
                  size_bytes = EXCLUDED.size_bytes,
                  is_staged = EXCLUDED.is_staged,
                  processing_error = NULL,
                  updated_at = NOW()
              RETURNING id, xmax, blurhash
            `, [folderPath, fileName, mimeType, stat.size, fileIdentifier, fileInfo.isStaged]);

            if (result.rows.length > 0 && (result.rows[0].xmax == 0 || !result.rows[0].blurhash)) {
              await dispatchMediaFile({ 
                mediaId: result.rows[0].id, 
                fullPath: fileInfo.fullPath,
                mimeType 
              });
            }
          } catch (fileErr: any) {
            console.error(`Error processing file ${fileName} in ${fileInfo.fullPath}:`, fileErr.message);
          }
        }
      }

      // Garbage Collection: Delete files that no longer exist on disk.
      if (currentFilesOnDisk.length > 0) {
        await query(`
          DELETE FROM media_files 
          WHERE folder_path = $1 AND file_name != ALL($2::text[])
        `, [folderPath, currentFilesOnDisk]);
      } else if (totalEntriesSeen > 0) {
        await query(`DELETE FROM media_files WHERE folder_path = $1`, [folderPath]);
      } else {
        const folderStillExists = mediaExists || stagingExists;
        if (!folderStillExists) {
          console.log(`[Scanner] Folder ${folderPath} no longer exists, removing DB records.`);
          await query(`DELETE FROM media_files WHERE folder_path = $1`, [folderPath]);
          await query(`DELETE FROM folder_settings WHERE folder_path = $1`, [folderPath]);
        }
      }

      // Pre-compute auto_cover_media_id if not set
      try {
        const coverCheck = await query(`SELECT cover_media_id, auto_cover_media_id FROM folder_settings WHERE folder_path = $1`, [folderPath]);
        if (!coverCheck.rows[0]?.cover_media_id && !coverCheck.rows[0]?.auto_cover_media_id) {
          const bestCover = await query(`
            SELECT id FROM media_files
            WHERE folder_path = $1 OR folder_path LIKE $1 || '/%'
            ORDER BY (blurhash IS NOT NULL) DESC, id ASC
            LIMIT 1
          `, [folderPath]);
          if (bestCover.rows.length > 0) {
            await query(`
              INSERT INTO folder_settings (folder_path, auto_cover_media_id)
              VALUES ($1, $2)
              ON CONFLICT (folder_path) DO UPDATE SET auto_cover_media_id = EXCLUDED.auto_cover_media_id
            `, [folderPath, bestCover.rows[0].id]);
          }
        }
      } catch (coverErr) {
        // non-critical
      }

      // Invalidate directory cache for this folder and its parent
      try {
        const parent = folderPath.includes('/') ? folderPath.substring(0, folderPath.lastIndexOf('/')) : '';
        await redis.del(`folder_dirs_v2:${folderPath}`).catch(() => {});
        await redis.del(`folder_dirs_v2:${parent}`).catch(() => {});
      } catch (cacheErr) {
        // non-critical
      }

    } catch (err: any) {
      console.error(`Error scanning directory for ${folderPath}:`, err.message);
    }
  }
}
