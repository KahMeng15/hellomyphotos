import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { query } from '../config/db';
import { MediaService } from '../modules/media/media.service';
import { smartSearchQueue } from './smartSearchQueue';
import { getExecutionMode } from './mode';

export const thumbnailQueue = new Queue('thumbnail', { connection: redis });

export let thumbnailWorker: Worker | undefined;
if (process.env.IS_WORKER === 'true') {
  thumbnailWorker = new Worker('thumbnail', async (job) => {
  const { mediaId, fullPath, mimeType, skipCascade } = job.data;
  console.log(`[Thumbnail Worker] Processing thumbnails for: ${(fullPath || mediaId).replace(/^.*\/media_ro\//, '')}`);

  if (mimeType && mimeType.startsWith('image/')) {
    const existing = await query('SELECT has_1080p, has_480p FROM media_files WHERE id = $1', [mediaId]);
    if (existing.rows.length > 0 && existing.rows[0].has_1080p && existing.rows[0].has_480p) {
      console.log(`[Thumbnail Worker] Skipping ${mediaId}, thumbnails already generated`);
    } else {
      await MediaService.processImage(mediaId, fullPath);
    }
  }

  // Sequential handoff
  const mode = await getExecutionMode();
  if (mode === 'sequential' && !skipCascade) {
    await smartSearchQueue.add('generate-smart-search', { mediaId, fullPath, mimeType });
  }
}, {
  connection: redis,
  concurrency: parseInt(process.env.THUMBNAIL_CONCURRENCY || '2', 10),
  removeOnComplete: { age: 3600 },
  removeOnFail: { age: 86400 }
});

  thumbnailWorker.on('failed', (job, err) => {
  console.error(`[Thumbnail Worker] Failed for ${(job?.data?.fullPath || job?.data?.mediaId).replace(/^.*\/media_ro\//, '')}:`, err);
});

}
