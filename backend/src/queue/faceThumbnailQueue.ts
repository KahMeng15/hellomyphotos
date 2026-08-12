import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { MLService } from '../modules/ml/ml.service';

export const faceThumbnailQueue = new Queue('face-thumbnail', { connection: redis });

export let faceThumbnailWorker: Worker | undefined;
if (process.env.IS_WORKER === 'true') {
  faceThumbnailWorker = new Worker('face-thumbnail', async (job) => {
    const { mediaId } = job.data;
    console.log(`[Face Thumbnail Worker] Generating face thumbnails for: ${mediaId}`);

    await MLService.generateFaceThumbnails(mediaId);
  }, {
    connection: redis,
    concurrency: parseInt(process.env.FACE_THUMBNAIL_CONCURRENCY || '2', 10),
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 }
  });

  faceThumbnailWorker.on('failed', (job, err) => {
    console.error(`[Face Thumbnail Worker] Failed for ${job?.data?.mediaId}:`, err);
  });
}
