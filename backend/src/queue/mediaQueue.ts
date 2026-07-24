import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { MediaService } from '../modules/media/media.service';

export const mediaQueue = new Queue('media-processing', { connection: redis });

export const mediaWorker = new Worker('media-processing', async (job) => {
  const { mediaId, fullPath, mimeType } = job.data;
  console.log(`[Worker] Processing media: ${fullPath}`);
  
  if (mimeType.startsWith('image/')) {
    await MediaService.processImage(mediaId, fullPath);
  } else if (mimeType.startsWith('video/')) {
    await MediaService.processVideo(mediaId, fullPath);
  }
}, { 
  connection: redis,
  concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2', 10)
});

mediaWorker.on('failed', (job, err) => {
  console.error(`[Worker] Media processing failed for ${job?.data?.fullPath}`, err);
});
