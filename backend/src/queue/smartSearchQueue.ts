import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { SmartSearchService } from '../modules/ml/smartSearch.service';
import { faceDetectionQueue } from './faceDetectionQueue';
import { getExecutionMode } from './mode';

export const smartSearchQueue = new Queue('smart-search', { connection: redis });

export let smartSearchWorker: Worker | undefined;
if (process.env.IS_WORKER === 'true') {
  smartSearchWorker = new Worker('smart-search', async (job) => {
  const { mediaId, fullPath, mimeType } = job.data;
  console.log(`[Smart Search Worker] Generating search index for: ${fullPath || mediaId}`);

  try {
    await SmartSearchService.processAndSaveMediaEmbedding(mediaId, fullPath);
  } catch (err: any) {
    console.error(`[Smart Search Worker] Embedding error for ${mediaId}:`, err.message);
    throw err;
  }

  // Next handoff step:
  const mode = await getExecutionMode();
  if (mode === 'sequential') {
    await faceDetectionQueue.add('detect-faces', { mediaId, fullPath, mimeType });
  }
}, {
  connection: redis,
  concurrency: parseInt(process.env.SMART_SEARCH_CONCURRENCY || '1', 10)
});

  smartSearchWorker.on('failed', (job, err) => {
  console.error(`[Smart Search Worker] Failed for ${job?.data?.fullPath || job?.data?.mediaId}:`, err);
});

}
