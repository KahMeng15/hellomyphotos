import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { MLService } from '../modules/ml/ml.service';

export const mlQueue = new Queue('machine-learning', { connection: redis });

export const mlWorker = new Worker('machine-learning', async (job) => {
  const { mediaId } = job.data;
  console.log(`[Worker] Running facial recognition for media: ${mediaId}`);
  
  await MLService.detectFaces(mediaId);
}, { 
  connection: redis,
  concurrency: parseInt(process.env.ML_CONCURRENCY || '1', 10)
});

mlWorker.on('failed', (job, err) => {
  console.error(`[Worker] ML processing failed for ${job?.data?.mediaId}`, err);
});
