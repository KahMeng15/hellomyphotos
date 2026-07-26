import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { MLService } from '../modules/ml/ml.service';
import { facialRecognitionQueue } from './facialRecognitionQueue';
import { getExecutionMode } from './mode';

export const faceDetectionQueue = new Queue('face-detection', { connection: redis });

export let faceDetectionWorker: Worker | undefined;
if (process.env.IS_WORKER === 'true') {
  faceDetectionWorker = new Worker('face-detection', async (job) => {
  const { mediaId, fullPath, mimeType } = job.data;
  console.log(`[Face Detection Worker] Running face detection for: ${(fullPath || mediaId).replace(/^.*\/media_ro\//, '')}`);

  if (!mimeType || mimeType.startsWith('image/')) {
    await MLService.detectFaces(mediaId, fullPath);
  }

  // Sequential handoff
  const mode = await getExecutionMode();
  if (mode === 'sequential') {
    await facialRecognitionQueue.add('recognize-faces', { mediaId, fullPath, mimeType });
  }
}, {
  connection: redis,
  concurrency: parseInt(process.env.FACE_DETECTION_CONCURRENCY || '1', 10)
});

  faceDetectionWorker.on('failed', (job, err) => {
  console.error(`[Face Detection Worker] Failed for ${(job?.data?.fullPath || job?.data?.mediaId).replace(/^.*\/media_ro\//, '')}:`, err);
});

}
