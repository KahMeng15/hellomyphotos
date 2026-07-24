import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { ScannerService } from '../modules/scanner/scanner.service';

export const scannerQueue = new Queue('scanner', { connection: redis });

export const scannerWorker = new Worker('scanner', async (job) => {
  const { folderPath } = job.data;
  console.log(`[Worker] Scanning folder: ${folderPath}`);
  await ScannerService.scanDirectory(folderPath);
}, { 
  connection: redis,
  concurrency: 1 // Can be dynamically adjusted via settings later
});

scannerWorker.on('completed', (job) => {
  console.log(`[Worker] Job completed for folder: ${job.data.folderPath}`);
});

scannerWorker.on('failed', (job, err) => {
  console.error(`[Worker] Job failed for folder: ${job?.data?.folderPath}`, err);
});
