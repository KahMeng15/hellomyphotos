import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { VideoService } from '../modules/media/video.service';
import { smartSearchQueue } from './smartSearchQueue';
import { getExecutionMode } from './mode';

export const videoQueue = new Queue('video', { connection: redis });

export let videoWorker: Worker | undefined;
if (process.env.IS_WORKER === 'true') {
  videoWorker = new Worker('video', async (job) => {
  const { mediaId, fullPath, mimeType } = job.data;
  console.log(`[Video Worker] Processing video for: ${fullPath || mediaId}`);

  if (mimeType && mimeType.startsWith('video/')) {
    await VideoService.processVideo(mediaId, fullPath);
  }

  // Sequential handoff
  const mode = await getExecutionMode();
  if (mode === 'sequential') {
    await smartSearchQueue.add('generate-smart-search', { mediaId, fullPath, mimeType });
  }
}, {
  connection: redis,
  concurrency: parseInt(process.env.VIDEO_CONCURRENCY || '1', 10)
});

  videoWorker.on('failed', (job, err) => {
  console.error(`[Video Worker] Failed for ${job?.data?.fullPath || job?.data?.mediaId}:`, err);
});

}
