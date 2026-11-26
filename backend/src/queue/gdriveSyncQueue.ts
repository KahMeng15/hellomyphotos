import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { query } from '../config/db';
import { GDriveService, FolderGDriveSyncRecord } from '../modules/gdrive/gdrive.service';
import { CaesiumService } from '../modules/gdrive/caesium.service';
import { STAGING_ROOT, MEDIA_ROOT } from '../utils/mediaPath';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

export interface GDriveJobData {
  type: 'upload-file' | 'sync-folder' | 'reconcile-cleanup';
  syncId?: string;
  accountId?: string;
  gdriveFolderId?: string;
  localFilePath?: string;
  fileName?: string;
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
        const { syncId, accountId, gdriveFolderId, localFilePath, fileName } = data;
        if (!syncId || !accountId || !gdriveFolderId || !localFilePath || !fileName) {
          throw new Error('Missing required upload parameters');
        }

        // Check if sync is paused or inactive
        const syncCheck = await query(`SELECT is_active, sync_status, caesium_enabled, caesium_config FROM folder_gdrive_syncs WHERE id = $1`, [syncId]);
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

        const originalStats = fs.statSync(localFilePath);
        let fileToUpload = localFilePath;
        let tempDirToClean: string | null = null;

        // Perform Caesium compression if enabled
        if (syncCheck.rows[0].caesium_enabled && CaesiumService.isSupported(fileName)) {
          try {
            const caesiumConfig = syncCheck.rows[0].caesium_config || {};
            const compressRes = await CaesiumService.compressImage(localFilePath, caesiumConfig);
            if (compressRes && fs.existsSync(compressRes.outputPath)) {
              tempDirToClean = compressRes.tempDir;
              if (compressRes.outputSize < originalStats.size) {
                fileToUpload = compressRes.outputPath;
                logger.info(`[GDrive Worker] Caesium compressed ${fileName}: ${(originalStats.size / 1024).toFixed(1)}KB -> ${(compressRes.outputSize / 1024).toFixed(1)}KB (${compressRes.savingsPercent} saved)`);
              } else {
                logger.info(`[GDrive Worker] Caesium output for ${fileName} (${compressRes.outputSize}B) was not smaller than original (${originalStats.size}B). Using original.`);
              }
            }
          } catch (compressErr: any) {
            logger.warn(`[GDrive Worker] Caesium compression failed for ${fileName}, falling back to original: ${compressErr.message}`);
          }
        }

        try {
          // Upload to Google Drive
          const { fileId } = await GDriveService.uploadJPEG({
            accountId,
            gdriveFolderId,
            localFilePath: fileToUpload,
            fileName
          });

          const uploadStats = fs.statSync(fileToUpload);

          // Track in synced files table
          await query(
            `INSERT INTO gdrive_synced_files (sync_id, file_name, file_size, gdrive_file_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (sync_id, file_name) DO UPDATE SET
               file_size = EXCLUDED.file_size,
               gdrive_file_id = EXCLUDED.gdrive_file_id,
               synced_at = NOW()`,
            [syncId, fileName, uploadStats.size, fileId]
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
          if (tempDirToClean) {
            await CaesiumService.cleanupTempDir(tempDirToClean);
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

        // Get local files matching JPEG
        let filesToUpload: Array<{ fileName: string; fullPath: string }> = [];

        if (sourceType === 'FASTUP') {
          const sessionDir = path.join(STAGING_ROOT, folderPath);
          if (fs.existsSync(sessionDir)) {
            const dirents = await fs.promises.readdir(sessionDir, { withFileTypes: true });
            for (const dirent of dirents) {
              if (dirent.isFile() && GDriveService.isJPEG(dirent.name)) {
                filesToUpload.push({
                  fileName: dirent.name,
                  fullPath: path.join(sessionDir, dirent.name)
                });
              }
            }
          }
        } else {
          const targetDir = folderPath ? path.join(MEDIA_ROOT, folderPath) : MEDIA_ROOT;
          if (fs.existsSync(targetDir)) {
            const dirents = await fs.promises.readdir(targetDir, { withFileTypes: true });
            for (const dirent of dirents) {
              if (dirent.isFile() && GDriveService.isJPEG(dirent.name)) {
                filesToUpload.push({
                  fileName: dirent.name,
                  fullPath: path.join(targetDir, dirent.name)
                });
              }
            }
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
            fileName: file.fileName
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
          `SELECT file_name, gdrive_file_id FROM gdrive_synced_files WHERE sync_id = $1`,
          [syncId]
        );

        const syncRes = await query(`SELECT folder_path, source_type FROM folder_gdrive_syncs WHERE id = $1`, [syncId]);
        if (syncRes.rows.length === 0) return;
        const { folder_path, source_type } = syncRes.rows[0];

        const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro'));
        const targetDir = folder_path ? path.join(MEDIA_ROOT, folder_path) : MEDIA_ROOT;

        for (const row of tracked.rows) {
          const localPath = path.join(targetDir, row.file_name);
          if (!fs.existsSync(localPath)) {
            // File was deleted / omitted during reconciliation -> Delete from Google Drive
            logger.info(`[GDrive Worker] Deleting missing file from Drive: ${row.file_name}`);
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
