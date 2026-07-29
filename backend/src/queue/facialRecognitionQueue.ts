import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { query } from '../config/db';
import { ClusterService } from '../modules/ml/cluster.service';
import { faceThumbnailQueue } from './faceThumbnailQueue';
import { getExecutionMode } from './mode';

export const facialRecognitionQueue = new Queue('facial-recognition', { connection: redis });

// C-4 Fix: Debounce recluster using BullMQ delayed jobs so the UI sees the active state.
async function scheduleRecluster(): Promise<void> {
  // Remove any existing delayed debounce job
  const existingJobs = await facialRecognitionQueue.getJobs(['delayed', 'waiting']);
  for (const j of existingJobs) {
    if (j.id === 'debounce-recluster') {
      await j.remove().catch(() => {});
    }
  }
  // Arm the debounce timer for 30 seconds
  await facialRecognitionQueue.add('recluster-all', {}, { jobId: 'debounce-recluster', delay: 30000 });
}

export let facialRecognitionWorker: Worker | undefined;
if (process.env.IS_WORKER === 'true') {
  facialRecognitionWorker = new Worker('facial-recognition', async (job) => {
    if (job.name === 'recluster-all') {
      console.log('[Facial Recognition Worker] Debounce settled — running DBSCAN recluster.');
      await ClusterService.reclusterFaces();

      // After clustering, queue face thumbnail regeneration for all people
      const people = await query(`SELECT DISTINCT fe.media_id FROM face_embeddings fe
        JOIN people p ON p.id = fe.person_id WHERE fe.person_id IS NOT NULL`);
      for (const row of people.rows) {
        await faceThumbnailQueue.add('generate-face-thumbnails', { mediaId: row.media_id },
          { jobId: `face-thumb-${row.media_id}-${Date.now()}` });
      }
      return;
    }

    // Otherwise, handle standard 'recognize-faces' individual job
    const { mediaId, fullPath } = job.data;
    console.log(`[Facial Recognition Worker] Scheduling recluster for: ${(fullPath || mediaId).replace(/^.*\/media_ro\//, '')}`);

    const unclustered = await query(
      'SELECT 1 FROM face_embeddings WHERE media_id = $1 AND person_id IS NULL LIMIT 1',
      [mediaId]
    );
    if (unclustered.rows.length === 0) {
      console.log(`[Facial Recognition Worker] No unclustered faces for ${mediaId}, skipping recluster.`);
    } else {
      await scheduleRecluster();
    }

    // Sequential mode: chain immediately to face-thumbnail for this specific media
    const mode = await getExecutionMode();
    if (mode === 'sequential') {
      await faceThumbnailQueue.add('generate-face-thumbnails', { mediaId },
        { jobId: `face-thumb-${mediaId}-${Date.now()}` });
    }
  }, {
    connection: redis,
    concurrency: parseInt(process.env.FACIAL_RECOGNITION_CONCURRENCY || '1', 10)
  });

  facialRecognitionWorker.on('failed', (job, err) => {
    console.error(`[Facial Recognition Worker] Failed for ${(job?.data?.fullPath || job?.data?.mediaId).replace(/^.*\/media_ro\//, '')}:`, err);
  });
}
