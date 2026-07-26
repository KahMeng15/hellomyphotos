import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { MediaService } from '../modules/media/media.service';
import { smartSearchQueue } from './smartSearchQueue';
import { getExecutionMode } from './mode';

export const thumbnailQueue = new Queue('thumbnail', { connection: redis });

export let thumbnailWorker: Worker | undefined;
if (process.env.IS_WORKER === 'true') {
  thumbnailWorker = new Worker('thumbnail', async (job) => {
  const { mediaId, fullPath, mimeType } = job.data;
  console.log(`[Thumbnail Worker] Processing thumbnails for: ${fullPath || mediaId}`);

  if (mimeType && mimeType.startsWith('image/')) {
    await MediaService.processImage(mediaId, fullPath);
  }

  // Sequential handoff
  const mode = await getExecutionMode();
  if (mode === 'sequential') {
    await smartSearchQueue.add('generate-smart-search', { mediaId, fullPath, mimeType });
  }
}, {
  connection: redis,
  concurrency: parseInt(process.env.THUMBNAIL_CONCURRENCY || '2', 10)
});

  thumbnailWorker.on('failed', (job, err) => {
  console.error(`[Thumbnail Worker] Failed for ${job?.data?.fullPath || job?.data?.mediaId}:`, err);
});

}
