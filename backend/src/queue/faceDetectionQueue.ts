import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { query } from '../config/db';
import { MLService } from '../modules/ml/ml.service';
import { facialRecognitionQueue } from './facialRecognitionQueue';

export const faceDetectionQueue = new Queue('face-detection', { connection: redis });

export let faceDetectionWorker: Worker | undefined;
if (process.env.IS_WORKER === 'true') {
  faceDetectionWorker = new Worker('face-detection', async (job) => {
  const { mediaId, fullPath, mimeType } = job.data;
  console.log(`[Face Detection Worker] Running face detection for: ${(fullPath || mediaId).replace(/^.*\/media_ro\//, '')}`);

  if (!mimeType || mimeType.startsWith('image/')) {
    const existing = await query('SELECT 1 FROM face_embeddings WHERE media_id = $1 LIMIT 1', [mediaId]);
    if (existing.rows.length > 0) {
      console.log(`[Face Detection Worker] Skipping ${mediaId}, faces already detected`);
    } else {
      await MLService.detectFaces(mediaId, fullPath);
    }
  }

  // Always trigger reclustering after detection completes
  await facialRecognitionQueue.add('recognize-faces', { mediaId, fullPath, mimeType });
}, {
  connection: redis,
  concurrency: parseInt(process.env.FACE_DETECTION_CONCURRENCY || '1', 10)
});

  faceDetectionWorker.on('failed', (job, err) => {
  console.error(`[Face Detection Worker] Failed for ${(job?.data?.fullPath || job?.data?.mediaId).replace(/^.*\/media_ro\//, '')}:`, err);
});

}
