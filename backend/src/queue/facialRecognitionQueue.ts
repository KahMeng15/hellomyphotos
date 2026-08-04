import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { query } from '../config/db';
import { ClusterService } from '../modules/ml/cluster.service';
import { faceThumbnailQueue } from './faceThumbnailQueue';
import { getExecutionMode } from './mode';

export const facialRecognitionQueue = new Queue('facial-recognition', { connection: redis });

// C-4 Fix: Debounce recluster using a Redis key + delayed job so we avoid loading all jobs into memory.
// Uses a Redis lock so only one debounce job is ever scheduled at a time.
async function scheduleRecluster(): Promise<void> {
  const LOCK_KEY = 'queue:facial-recognition:recluster-pending';
  // If a recluster is already scheduled, just extend the TTL to reset the debounce window
  const already = await redis.set(LOCK_KEY, '1', 'EX', 35, 'NX');
  if (!already) {
    // Already pending — refresh TTL to extend debounce window
    await redis.expire(LOCK_KEY, 35);
    return;
  }
  // Arm the debounce timer for 30 seconds (lock TTL of 35s gives a 5s buffer)
  await facialRecognitionQueue.add('recluster-all', {}, { jobId: 'debounce-recluster', delay: 30000,
    removeOnComplete: true, removeOnFail: { age: 3600 } });
}

export let facialRecognitionWorker: Worker | undefined;
if (process.env.IS_WORKER === 'true') {
  facialRecognitionWorker = new Worker('facial-recognition', async (job) => {
    if (job.name === 'recluster-all') {
      console.log('[Facial Recognition Worker] Debounce settled — running DBSCAN recluster.');
      // Clear the debounce lock so future triggers can schedule a new recluster
      await redis.del('queue:facial-recognition:recluster-pending');
      await ClusterService.reclusterFaces();

      // After clustering, queue face thumbnail regeneration in bulk (not one job per person)
      const people = await query(`SELECT DISTINCT fe.media_id FROM face_embeddings fe
        JOIN people p ON p.id = fe.person_id WHERE fe.person_id IS NOT NULL LIMIT 5000`);
      if (people.rows.length > 0) {
        await faceThumbnailQueue.addBulk(people.rows.map(row => ({
          name: 'generate-face-thumbnails',
          data: { mediaId: row.media_id },
          opts: { jobId: `face-thumb-${row.media_id}`, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } }
        })));
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
    concurrency: parseInt(process.env.FACIAL_RECOGNITION_CONCURRENCY || '1', 10),
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 }
  });

  facialRecognitionWorker.on('failed', (job, err) => {
    console.error(`[Facial Recognition Worker] Failed for ${(job?.data?.fullPath || job?.data?.mediaId).replace(/^.*\/media_ro\//, '')}:`, err);
  });
}
