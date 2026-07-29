import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { query } from '../config/db';
import { ClusterService } from '../modules/ml/cluster.service';
import { faceThumbnailQueue } from './faceThumbnailQueue';
import { getExecutionMode } from './mode';

export const facialRecognitionQueue = new Queue('facial-recognition', { connection: redis });

// C-4 Fix: Debounce recluster so it runs once after a burst of detections settles.
// Each recognition job arms a 30-second timer in Redis. The last job to arrive
// wins and triggers the actual (expensive) O(n²) DBSCAN cluster run.
const RECLUSTER_DEBOUNCE_KEY = 'recluster:debounce_timer';
const RECLUSTER_DEBOUNCE_MS = 30_000;
let reclusterDebounceHandle: ReturnType<typeof setTimeout> | null = null;

function scheduleRecluster(): void {
  // Clear any existing in-process debounce timer
  if (reclusterDebounceHandle !== null) {
    clearTimeout(reclusterDebounceHandle);
  }
  reclusterDebounceHandle = setTimeout(async () => {
    reclusterDebounceHandle = null;
    try {
      // Use a Redis lock to prevent concurrent cluster runs across worker restarts
      const lock = await redis.set(RECLUSTER_DEBOUNCE_KEY, '1', 'EX', 300, 'NX');
      if (!lock) {
        console.log('[Facial Recognition] Recluster already running, skipping.');
        return;
      }
      console.log('[Facial Recognition] Debounce settled — running DBSCAN recluster.');
      await ClusterService.reclusterFaces();

      // After clustering, queue face thumbnail regeneration for all people
      const people = await query(`SELECT DISTINCT fe.media_id FROM face_embeddings fe
        JOIN people p ON p.id = fe.person_id WHERE fe.person_id IS NOT NULL`);
      for (const row of people.rows) {
        await faceThumbnailQueue.add('generate-face-thumbnails', { mediaId: row.media_id },
          { jobId: `face-thumb-${row.media_id}` });
      }
    } catch (err) {
      console.error('[Facial Recognition] Debounced recluster failed:', err);
    } finally {
      await redis.del(RECLUSTER_DEBOUNCE_KEY);
    }
  }, RECLUSTER_DEBOUNCE_MS);
}

export let facialRecognitionWorker: Worker | undefined;
if (process.env.IS_WORKER === 'true') {
  facialRecognitionWorker = new Worker('facial-recognition', async (job) => {
    const { mediaId, fullPath } = job.data;
    console.log(`[Facial Recognition Worker] Scheduling recluster for: ${(fullPath || mediaId).replace(/^.*\/media_ro\//, '')}`);

    const unclustered = await query(
      'SELECT 1 FROM face_embeddings WHERE media_id = $1 AND person_id IS NULL LIMIT 1',
      [mediaId]
    );
    if (unclustered.rows.length === 0) {
      console.log(`[Facial Recognition Worker] No unclustered faces for ${mediaId}, skipping recluster.`);
    } else {
      // Arm the debounce — actual clustering happens 30s after the last upload settles
      scheduleRecluster();
    }

    // Sequential mode: chain immediately to face-thumbnail for this specific media
    const mode = await getExecutionMode();
    if (mode === 'sequential') {
      await faceThumbnailQueue.add('generate-face-thumbnails', { mediaId },
        { jobId: `face-thumb-${mediaId}` });
    }
  }, {
    connection: redis,
    concurrency: parseInt(process.env.FACIAL_RECOGNITION_CONCURRENCY || '1', 10)
  });

  facialRecognitionWorker.on('failed', (job, err) => {
    console.error(`[Facial Recognition Worker] Failed for ${(job?.data?.fullPath || job?.data?.mediaId).replace(/^.*\/media_ro\//, '')}:`, err);
  });
}
