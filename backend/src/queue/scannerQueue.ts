import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { ScannerService } from '../modules/scanner/scanner.service';
import { query } from '../config/db';
import fs from 'fs';
import path from 'path';

export const scannerQueue = new Queue('scanner', { connection: redis });

export let scannerWorker: Worker | undefined;
if (process.env.IS_WORKER === 'true') {
  scannerWorker = new Worker('scanner', async (job) => {
    if (job.name === 'cleanup-orphans') {
      console.log(`[Scanner Worker] Running orphan cleanup task...`);
      try {
        const res = await query(`DELETE FROM people WHERE id NOT IN (SELECT person_id FROM face_embeddings WHERE person_id IS NOT NULL)`);
        if (res.rowCount && res.rowCount > 0) console.log(`[Scanner Worker] Cleaned up ${res.rowCount} orphaned people.`);

        const CACHE_ROOT = process.env.CACHE_ROOT || path.join(process.cwd(), '../volumes/cache_rw');
        
        for (const [dirName, tableName] of [['thumbnails', 'media_files'], ['faces', 'face_embeddings'], ['previews', 'media_files']]) {
          const dirPath = path.join(CACHE_ROOT, dirName);
          if (!fs.existsSync(dirPath)) continue;
          const files = await fs.promises.readdir(dirPath);
          const uuids = files.map(f => f.split('.')[0]).filter(id => id.length === 36);
          if (uuids.length === 0) continue;
          
          // Chunk UUIDs to avoid overly large queries if directory is huge
          const chunkSize = 1000;
          const validIds = new Set<string>();
          for (let i = 0; i < uuids.length; i += chunkSize) {
            const chunk = uuids.slice(i, i + chunkSize);
            const dbIdsRes = await query(`SELECT id FROM ${tableName} WHERE id = ANY($1::uuid[])`, [chunk]);
            dbIdsRes.rows.forEach(r => validIds.add(r.id));
          }

          let delCount = 0;
          for (const file of files) {
            const id = file.split('.')[0];
            if (id.length === 36 && !validIds.has(id)) {
              await fs.promises.unlink(path.join(dirPath, file)).catch(()=>{});
              delCount++;
            }
          }
          if (delCount > 0) console.log(`[Scanner Worker] Deleted ${delCount} orphaned files in ${dirName}.`);
        }
      } catch (err) {
        console.error('[Scanner Worker] Cleanup error:', err);
      }
      return;
    }

    const { folderPath } = job.data;
    console.log(`[Scanner Worker] Scanning folder: ${folderPath ?? ''}`);
    await ScannerService.scanDirectory(folderPath ?? '');
    await scannerQueue.add('cleanup-orphans', {}, { delay: 5000, removeOnComplete: true });
  }, { 
    connection: redis,
    concurrency: 1 
  });

  scannerWorker.on('completed', (job) => {
    console.log(`[Scanner Worker] Job completed for ${job.name}: ${job.data?.folderPath ?? ''}`);
  });

  scannerWorker.on('failed', (job, err) => {
    console.error(`[Scanner Worker] Job failed for ${job?.name}: ${job?.data?.folderPath ?? ''}`, err);
  });
}
