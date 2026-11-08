import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { query } from '../config/db';
import { MetadataService } from '../modules/media/metadata.service';
import { thumbnailQueue } from './thumbnailQueue';
import { videoQueue } from './videoQueue';
import { getExecutionMode } from './mode';

export const metadataQueue = new Queue('metadata', { connection: redis });

export let metadataWorker: Worker | undefined;
if (process.env.IS_WORKER === 'true') {
  metadataWorker = new Worker('metadata', async (job) => {
  const { mediaId, fullPath, mimeType, skipCascade } = job.data;
  console.log(`[Metadata Worker] Extracting metadata for: ${(fullPath || mediaId).replace(/^.*\/media_ro\//, '')}`);

  const existing = await query('SELECT exif_json FROM media_files WHERE id = $1', [mediaId]);
  if (existing.rows.length > 0 && existing.rows[0].exif_json !== null) {
    console.log(`[Metadata Worker] Skipping ${mediaId}, metadata already extracted`);
  } else {
    await MetadataService.extractMetadata(mediaId, fullPath, mimeType);
  }

  // Pipeline handoff: chain to next stage per-image
  const mode = await getExecutionMode();
  if (mode === 'pipeline' && !skipCascade) {
    if (mimeType && mimeType.startsWith('video/')) {
      await videoQueue.add('process-video', { mediaId, fullPath, mimeType });
    } else {
      await thumbnailQueue.add('generate-thumbnail', { mediaId, fullPath, mimeType });
    }
  }
}, {
  connection: redis,
  concurrency: parseInt(process.env.METADATA_CONCURRENCY || '2', 10),
  removeOnComplete: { age: 3600 },
  removeOnFail: { age: 86400 }
});

  metadataWorker.on('failed', async (job, err) => {
    console.error(`[Metadata Worker] Failed for ${(job?.data?.fullPath || job?.data?.mediaId).replace(/^.*\/media_ro\//, '')}:`, err);
    if (job?.data?.mediaId) {
      const errCode = (err as any)?.code || (err?.message?.includes('ENOENT') ? 'FILE_NOT_FOUND' : err?.message?.slice(0, 100));
      await query(
        `UPDATE media_files SET processing_error = $1, failed_attempts = COALESCE(failed_attempts, 0) + 1, updated_at = NOW() WHERE id = $2`,
        [errCode, job.data.mediaId]
      ).catch(() => {});
    }
  });

}
