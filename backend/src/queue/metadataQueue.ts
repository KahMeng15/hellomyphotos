import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { MetadataService } from '../modules/media/metadata.service';
import { thumbnailQueue } from './thumbnailQueue';
import { videoQueue } from './videoQueue';
import { getExecutionMode } from './mode';

export const metadataQueue = new Queue('metadata', { connection: redis });

export let metadataWorker: Worker | undefined;
if (process.env.IS_WORKER === 'true') {
  metadataWorker = new Worker('metadata', async (job) => {
  const { mediaId, fullPath, mimeType } = job.data;
  console.log(`[Metadata Worker] Extracting metadata for: ${(fullPath || mediaId).replace(/^.*\/media_ro\//, '')}`);

  await MetadataService.extractMetadata(mediaId, fullPath, mimeType);

  // Sequential handoff
  const mode = await getExecutionMode();
  if (mode === 'sequential') {
    if (mimeType && mimeType.startsWith('video/')) {
      await videoQueue.add('process-video', { mediaId, fullPath, mimeType });
    } else {
      await thumbnailQueue.add('generate-thumbnail', { mediaId, fullPath, mimeType });
    }
  }
}, {
  connection: redis,
  concurrency: parseInt(process.env.METADATA_CONCURRENCY || '2', 10)
});

  metadataWorker.on('failed', (job, err) => {
  console.error(`[Metadata Worker] Failed for ${(job?.data?.fullPath || job?.data?.mediaId).replace(/^.*\/media_ro\//, '')}:`, err);
});

}
