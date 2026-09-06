import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { OgService } from '../modules/media/og.service';

export const ogQueue = new Queue('og', { connection: redis });

export let ogWorker: Worker | undefined;
if (process.env.IS_WORKER === 'true') {
  ogWorker = new Worker('og', async (job) => {
    const { token, folderPath } = job.data;
    console.log(`[OG Worker] Generating OG image for folder: ${folderPath}`);
    await OgService.generateForFolder(token, folderPath);
  }, {
    connection: redis,
    concurrency: 2,
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 }
  });

  ogWorker.on('failed', (job, err) => {
    console.error(`[OG Worker] Failed for ${job?.data?.folderPath}:`, err);
  });
}
