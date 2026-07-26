import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { ScannerService } from '../modules/scanner/scanner.service';

export const scannerQueue = new Queue('scanner', { connection: redis });

export let scannerWorker: Worker | undefined;
if (process.env.IS_WORKER === 'true') {
  scannerWorker = new Worker('scanner', async (job) => {
  const { folderPath } = job.data;
  console.log(`[Scanner Worker] Scanning folder: ${folderPath ?? ''}`);
  await ScannerService.scanDirectory(folderPath ?? '');
}, { 
  connection: redis,
  concurrency: 1 
});

  scannerWorker.on('completed', (job) => {
  console.log(`[Scanner Worker] Job completed for folder: ${job.data?.folderPath ?? ''}`);
});

  scannerWorker.on('failed', (job, err) => {
  console.error(`[Scanner Worker] Job failed for folder: ${job?.data?.folderPath ?? ''}`, err);
});

}
