import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { query } from '../config/db';
import { GDriveService, FolderGDriveSyncRecord } from '../modules/gdrive/gdrive.service';
import { CaesiumService } from '../modules/gdrive/caesium.service';
import { WatermarkService, WatermarkTemplate } from '../modules/media/watermark.service';
import { STAGING_ROOT, MEDIA_ROOT } from '../utils/mediaPath';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface GDriveJobData {
  type: 'upload-file' | 'sync-folder' | 'reconcile-cleanup';
  syncId?: string;
  accountId?: string;
  gdriveFolderId?: string;
  localFilePath?: string;
  fileName?: string;
  relativePath?: string; // subfolder path relative to synced root (e.g. "subfolder/event")
  folderPath?: string;
  sourceType?: 'MEDIA' | 'FASTUP';
}

export const gdriveSyncQueue = new Queue<GDriveJobData>('gdrive-sync', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 }
  }
});

export let gdriveSyncWorker: Worker<GDriveJobData> | undefined;

// Worker execution
if (process.env.IS_WORKER === 'true' || process.env.DISABLE_WORKER !== 'true') {
  CaesiumService.cleanupStaleTempDirs().catch(() => {});
  gdriveSyncWorker = new Worker<GDriveJobData>(
    'gdrive-sync',
    async (job) => {
      const data = job.data;

      if (data.type === 'upload-file') {
        const { syncId, accountId, gdriveFolderId, localFilePath, fileName, relativePath = '' } = data;
        if (!syncId || !accountId || !gdriveFolderId || !localFilePath || !fileName) {
          throw new Error('Missing required upload parameters');
        }

        // Check if sync is paused or inactive
        const syncCheck = await query(
          `SELECT is_active, sync_status, caesium_enabled, caesium_config, watermark_enabled, watermark_template_id, folder_path, source_type 
           FROM folder_gdrive_syncs WHERE id = $1`,
          [syncId]
        );
        if (syncCheck.rows.length === 0 || !syncCheck.rows[0].is_active || syncCheck.rows[0].sync_status === 'PAUSED') {
          logger.info(`[GDrive Worker] Skipping upload for ${fileName}: sync is paused or inactive.`);
          return;
        }

        if (!GDriveService.isJPEG(fileName)) {
          logger.info(`[GDrive Worker] Skipping non-JPEG file: ${fileName}`);
          return;
        }

        if (!fs.existsSync(localFilePath)) {
          logger.warn(`[GDrive Worker] File not found: ${localFilePath}`);
          return;
        }

        const syncRow = syncCheck.rows[0];
        let fileToUpload = localFilePath;
        let tempWatermarkDir: string | null = null;
        let tempCaesiumDir: string | null = null;

        try {
          // 1. Watermark pipeline (watermark first)
          const { enforceGlobal, globalTemplateId } = await WatermarkService.getGlobalEnforcement();
          let effectiveTemplate: WatermarkTemplate | null = null;

          if (enforceGlobal) {
            if (globalTemplateId) {
              effectiveTemplate = await WatermarkService.getTemplate(globalTemplateId);
            }
            if (!effectiveTemplate) {
              effectiveTemplate = await WatermarkService.getDefaultTemplate();
            }
          } else if (syncRow.watermark_enabled || syncRow.watermark_template_id) {
            if (syncRow.watermark_template_id) {
              effectiveTemplate = await WatermarkService.getTemplate(syncRow.watermark_template_id);
            }
            if (!effectiveTemplate && syncRow.watermark_enabled) {
              effectiveTemplate = await WatermarkService.getDefaultTemplate();
            }
          }

          if (effectiveTemplate) {
            const effectiveRelativePath = relativePath.replace(/^\/+|\/+$/g, '');
            const targetDbFolderPath = effectiveRelativePath
              ? (syncRow.folder_path ? `${syncRow.folder_path}/${effectiveRelativePath}` : effectiveRelativePath)
              : syncRow.folder_path;

            let metadata: any = { file_name: fileName, folder_path: targetDbFolderPath };
            try {
              const metaRes = await query(
                `SELECT id, file_name, folder_path, created_at,
                        exif_json->>'DateTimeOriginal' as captured_at,
                        exif_json->>'Make' as camera_make,
                        exif_json->>'Model' as camera_model,
                        exif_json->>'LensModel' as lens_model,
                        exif_json->>'ISO' as iso,
                        exif_json->>'ExposureTime' as shutter_speed,
                        exif_json->>'FNumber' as f_number,
                        exif_json->>'Copyright' as copyright
                 FROM media_files 
                 WHERE file_name = $1 AND (folder_path = $2 OR folder_path LIKE $3)
                 LIMIT 1`,
                [fileName, targetDbFolderPath, `${targetDbFolderPath}/%`]
              );
              if (metaRes.rows.length > 0) {
                metadata = metaRes.rows[0];
              }
            } catch (err: any) {
              logger.warn(`[GDrive Worker] Metadata query error for ${fileName}:`, err.message);
            }

            try {
              const watermarkedBuffer = await WatermarkService.addWatermarkToStream(
                localFilePath,
                effectiveTemplate,
                metadata,
                'jpeg'
              );

              tempWatermarkDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gdrive-wm-'));
              const tempWatermarkedFile = path.join(tempWatermarkDir, fileName);
              await fs.promises.writeFile(tempWatermarkedFile, watermarkedBuffer);
              fileToUpload = tempWatermarkedFile;
              logger.info(`[GDrive Worker] Watermarked ${fileName} with template "${effectiveTemplate.name}"`);
            } catch (wmErr: any) {
              logger.error(`[GDrive Worker] Watermarking failed for ${fileName}, falling back to original:`, wmErr.message);
            }
          }

          // 2. Compression pipeline (watermark then only compress for upload to gdrive)
          if (syncRow.caesium_enabled && CaesiumService.isSupported(fileName)) {
            try {
              const preCompressStats = fs.statSync(fileToUpload);
              const caesiumConfig = syncRow.caesium_config || {};
              const compressRes = await CaesiumService.compressImage(fileToUpload, caesiumConfig);
              if (compressRes && fs.existsSync(compressRes.outputPath)) {
                tempCaesiumDir = compressRes.tempDir;
                if (compressRes.outputSize < preCompressStats.size) {
                  fileToUpload = compressRes.outputPath;
                  logger.info(`[GDrive Worker] Caesium compressed ${fileName}: ${(preCompressStats.size / 1024).toFixed(1)}KB -> ${(compressRes.outputSize / 1024).toFixed(1)}KB (${compressRes.savingsPercent} saved)`);
                } else {
                  logger.info(`[GDrive Worker] Caesium output for ${fileName} (${compressRes.outputSize}B) was not smaller than input (${preCompressStats.size}B). Using uncompressed.`);
                }
              }
            } catch (compressErr: any) {
              logger.warn(`[GDrive Worker] Caesium compression failed for ${fileName}: ${compressErr.message}`);
            }
          }

          // Resolve destination folder on Google Drive (creating subfolder hierarchy if relativePath is present)
          let targetFolderId = gdriveFolderId;
          const cleanRelPath = relativePath.replace(/^\/+|\/+$/g, '').trim();
          if (cleanRelPath) {
            targetFolderId = await GDriveService.getOrCreateSubfolderPath({
              accountId,
              parentFolderId: gdriveFolderId,
              relativePath: cleanRelPath
            });
          }

          // 3. Upload to Google Drive
          const { fileId } = await GDriveService.uploadJPEG({
            accountId,
            gdriveFolderId: targetFolderId,
            localFilePath: fileToUpload,
            fileName
          });

          const uploadStats = fs.statSync(fileToUpload);

          // Track in synced files table (handling relative_path)
          await query(
            `INSERT INTO gdrive_synced_files (sync_id, file_name, file_size, gdrive_file_id, relative_path)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (sync_id, file_name) DO UPDATE SET
               file_size = EXCLUDED.file_size,
               gdrive_file_id = EXCLUDED.gdrive_file_id,
               relative_path = EXCLUDED.relative_path,
               synced_at = NOW()`,
            [syncId, fileName, uploadStats.size, fileId, cleanRelPath]
          );

          // Update sync record
          await query(
            `UPDATE folder_gdrive_syncs 
             SET last_synced_at = NOW(), sync_status = 'IDLE', error_message = NULL 
             WHERE id = $1`,
            [syncId]
          );

          logger.info(`[GDrive Worker] Successfully uploaded ${fileName} to Google Drive (${fileId})`);
        } finally {
          // Discard temporary watermarked and compressed files if generated
          if (tempWatermarkDir) {
            await fs.promises.rm(tempWatermarkDir, { recursive: true, force: true }).catch(() => {});
          }
          if (tempCaesiumDir) {
            await CaesiumService.cleanupTempDir(tempCaesiumDir).catch(() => {});
          }
        }
      }

      else if (data.type === 'sync-folder') {
        const { folderPath, sourceType } = data;
        if (!folderPath || !sourceType) {
          throw new Error('folderPath and sourceType are required for sync-folder');
        }

        const syncConfig = await GDriveService.getSyncConfig(folderPath, sourceType);
        if (!syncConfig || !syncConfig.is_active) {
          return;
        }

        await query(`UPDATE folder_gdrive_syncs SET sync_status = 'SYNCING' WHERE id = $1`, [syncConfig.id]);

        // Helper function to recursively find all JPEG files with relative paths
        const scanDirectoryRecursively = async (baseDir: string, currentRelative = ''): Promise<Array<{ fileName: string; fullPath: string; relativePath: string }>> => {
          const results: Array<{ fileName: string; fullPath: string; relativePath: string }> = [];
          const dirToRead = currentRelative ? path.join(baseDir, currentRelative) : baseDir;
          if (!fs.existsSync(dirToRead)) return results;

          let dirents: fs.Dirent[] = [];
          try {
            dirents = await fs.promises.readdir(dirToRead, { withFileTypes: true });
          } catch (e: any) {
            logger.warn(`[GDrive Sync] Could not read directory ${dirToRead}: ${e.message}`);
            return results;
          }

          for (const dirent of dirents) {
            if (dirent.name.startsWith('.')) continue; // skip hidden files

            if (dirent.isDirectory()) {
              const nextRel = currentRelative ? `${currentRelative}/${dirent.name}` : dirent.name;
              const subResults = await scanDirectoryRecursively(baseDir, nextRel);
              results.push(...subResults);
            } else if (dirent.isFile() && GDriveService.isJPEG(dirent.name)) {
              results.push({
                fileName: dirent.name,
                fullPath: path.join(dirToRead, dirent.name),
                relativePath: currentRelative
              });
            }
          }
          return results;
        };

        // Get local files matching JPEG recursively
        let filesToUpload: Array<{ fileName: string; fullPath: string; relativePath: string }> = [];

        if (sourceType === 'FASTUP') {
          const sessionDir = path.join(STAGING_ROOT, folderPath);
          if (fs.existsSync(sessionDir)) {
            filesToUpload = await scanDirectoryRecursively(sessionDir);
          }
        } else {
          const targetDir = folderPath ? path.join(MEDIA_ROOT, folderPath) : MEDIA_ROOT;
          if (fs.existsSync(targetDir)) {
            filesToUpload = await scanDirectoryRecursively(targetDir);
          }
        }

        // Enqueue individual file upload jobs to control rate limits
        for (const file of filesToUpload) {
          await gdriveSyncQueue.add('upload-file', {
            type: 'upload-file',
            syncId: syncConfig.id,
            accountId: syncConfig.account_id,
            gdriveFolderId: syncConfig.gdrive_folder_id,
            localFilePath: file.fullPath,
            fileName: file.fileName,
            relativePath: file.relativePath
          });
        }

        await query(
          `UPDATE folder_gdrive_syncs SET sync_status = 'IDLE', last_synced_at = NOW() WHERE id = $1`,
          [syncConfig.id]
        );
      }

      else if (data.type === 'reconcile-cleanup') {
        const { syncId, accountId } = data;
        if (!syncId || !accountId) return;

        // Fetch all tracked files for this sync
        const tracked = await query(
          `SELECT file_name, relative_path, gdrive_file_id FROM gdrive_synced_files WHERE sync_id = $1`,
          [syncId]
        );

        const syncRes = await query(`SELECT folder_path, source_type FROM folder_gdrive_syncs WHERE id = $1`, [syncId]);
        if (syncRes.rows.length === 0) return;
        const { folder_path, source_type } = syncRes.rows[0];

        const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro'));
        const targetDir = folder_path ? path.join(MEDIA_ROOT, folder_path) : MEDIA_ROOT;

        for (const row of tracked.rows) {
          const rel = (row.relative_path || '').replace(/^\/+|\/+$/g, '');
          const localPath = rel ? path.join(targetDir, rel, row.file_name) : path.join(targetDir, row.file_name);
          if (!fs.existsSync(localPath)) {
            // File was deleted / omitted during reconciliation -> Delete from Google Drive
            logger.info(`[GDrive Worker] Deleting missing file from Drive: ${rel ? `${rel}/` : ''}${row.file_name}`);
            await GDriveService.deleteGDriveFile(accountId, row.gdrive_file_id);
            await query(`DELETE FROM gdrive_synced_files WHERE sync_id = $1 AND file_name = $2`, [syncId, row.file_name]);
          }
        }
      }
    },
    {
      connection: redis,
      // Concurrency 3 to stay safely under Google Drive API's requests/sec limit
      concurrency: parseInt(process.env.GDRIVE_SYNC_CONCURRENCY || '3', 10),
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 }
    }
  );

  gdriveSyncWorker.on('failed', async (job, err) => {
    logger.error(`[GDrive Worker] Job failed: ${job?.name || 'unknown'}:`, err);
    if (job?.data?.syncId) {
      await query(
        `UPDATE folder_gdrive_syncs SET sync_status = 'ERROR', error_message = $1 WHERE id = $2`,
        [err.message.slice(0, 255), job.data.syncId]
      ).catch(() => {});
    }
  });
}
