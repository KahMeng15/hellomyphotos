import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { ClusterService } from '../modules/ml/cluster.service';

export const facialRecognitionQueue = new Queue('facial-recognition', { connection: redis });

export let facialRecognitionWorker: Worker | undefined;
if (process.env.IS_WORKER === 'true') {
  facialRecognitionWorker = new Worker('facial-recognition', async (job) => {
  const { mediaId, fullPath } = job.data;
  console.log(`[Facial Recognition Worker] Running recognition/clustering for: ${(fullPath || mediaId).replace(/^.*\/media_ro\//, '')}`);

  await ClusterService.reclusterFaces();
}, {
  connection: redis,
  concurrency: parseInt(process.env.FACIAL_RECOGNITION_CONCURRENCY || '1', 10)
});

  facialRecognitionWorker.on('failed', (job, err) => {
  console.error(`[Facial Recognition Worker] Failed for ${(job?.data?.fullPath || job?.data?.mediaId).replace(/^.*\/media_ro\//, '')}:`, err);
});

}
