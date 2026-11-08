import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { query } from '../config/db';
import { VideoService } from '../modules/media/video.service';
import { smartSearchQueue } from './smartSearchQueue';
import { getExecutionMode } from './mode';

export const videoQueue = new Queue('video', { connection: redis });

export let videoWorker: Worker | undefined;
if (process.env.IS_WORKER === 'true') {
  videoWorker = new Worker('video', async (job) => {
  const { mediaId, fullPath, mimeType } = job.data;
  console.log(`[Video Worker] Processing video for: ${(fullPath || mediaId).replace(/^.*\/media_ro\//, '')}`);

  let actionTaken = 'processed';
  if (mimeType && mimeType.startsWith('video/')) {
    const existing = await query('SELECT has_480p FROM media_files WHERE id = $1', [mediaId]);
    if (existing.rows.length > 0 && existing.rows[0].has_480p) {
      console.log(`[Video Worker] Skipping ${mediaId}, video already processed`);
      actionTaken = 'skipped';
    } else {
      console.log(`[Video Worker] Processing ${mediaId}, has_480p is ${existing.rows[0].has_480p}`);
      await VideoService.processVideo(mediaId, fullPath);
    }
  }

  // Pipeline handoff: chain to next stage per-image
  const mode = await getExecutionMode();
  if (mode === 'pipeline') {
    await smartSearchQueue.add('generate-smart-search', { mediaId, fullPath, mimeType }, {
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 }
    });
  }
  
  return { action: actionTaken };
}, {
  connection: redis,
  concurrency: parseInt(process.env.VIDEO_CONCURRENCY || '1', 10),
  removeOnComplete: { age: 3600 },
  removeOnFail: { age: 86400 }
});

  videoWorker.on('failed', async (job, err) => {
    console.error(`[Video Worker] Failed for ${(job?.data?.fullPath || job?.data?.mediaId).replace(/^.*\/media_ro\//, '')}:`, err);
    if (job?.data?.mediaId) {
      const errCode = (err as any)?.code || (err?.message?.includes('ENOENT') ? 'FILE_NOT_FOUND' : err?.message?.slice(0, 100));
      await query(
        `UPDATE media_files SET processing_error = $1, failed_attempts = COALESCE(failed_attempts, 0) + 1, updated_at = NOW() WHERE id = $2`,
        [errCode, job.data.mediaId]
      ).catch(() => {});
    }
  });

}
