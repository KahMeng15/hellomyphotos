import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { query } from '../config/db';
import { SmartSearchService } from '../modules/ml/smartSearch.service';
import { faceDetectionQueue } from './faceDetectionQueue';
import { getExecutionMode } from './mode';

export const smartSearchQueue = new Queue('smart-search', { connection: redis });

export let smartSearchWorker: Worker | undefined;
if (process.env.IS_WORKER === 'true') {
  smartSearchWorker = new Worker('smart-search', async (job) => {
  const { mediaId, fullPath, mimeType } = job.data;
  console.log(`[Smart Search Worker] Generating search index for: ${(fullPath || mediaId).replace(/^.*\/media_ro\//, '')}`);

  const existing = await query('SELECT clip_embedding FROM media_files WHERE id = $1', [mediaId]);
  if (existing.rows.length > 0 && existing.rows[0].clip_embedding !== null) {
    console.log(`[Smart Search Worker] Skipping ${mediaId}, embedding already generated`);
  } else {
    try {
      await SmartSearchService.processAndSaveMediaEmbedding(mediaId, fullPath);
    } catch (err: any) {
      console.error(`[Smart Search Worker] Embedding error for ${mediaId}:`, err.message);
      throw err;
    }
  }

  // Next handoff step:
  const mode = await getExecutionMode();
  if (mode === 'sequential') {
    await faceDetectionQueue.add('detect-faces', { mediaId, fullPath, mimeType });
  }
}, {
  connection: redis,
  concurrency: parseInt(process.env.SMART_SEARCH_CONCURRENCY || '1', 10),
  removeOnComplete: { age: 3600 },
  removeOnFail: { age: 86400 }
});

  smartSearchWorker.on('failed', (job, err) => {
  console.error(`[Smart Search Worker] Failed for ${(job?.data?.fullPath || job?.data?.mediaId).replace(/^.*\/media_ro\//, '')}:`, err);
});

}
