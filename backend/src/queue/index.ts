import { Queue, Worker } from 'bullmq';
import { scannerQueue, scannerWorker } from './scannerQueue';
import { metadataQueue, metadataWorker } from './metadataQueue';
import { thumbnailQueue, thumbnailWorker } from './thumbnailQueue';
import { videoQueue, videoWorker } from './videoQueue';
import { smartSearchQueue, smartSearchWorker } from './smartSearchQueue';
import { faceDetectionQueue, faceDetectionWorker } from './faceDetectionQueue';
import { facialRecognitionQueue, facialRecognitionWorker } from './facialRecognitionQueue';
import { faceThumbnailQueue, faceThumbnailWorker } from './faceThumbnailQueue';
import { ogQueue, ogWorker } from './ogQueue';
import { getExecutionMode, setExecutionMode, type QueueExecutionMode } from './mode';
import { logger } from '../utils/logger';
import { dispatchMediaFile, MediaJobData } from './dispatch';

const allWorkers: [string, Worker | undefined][] = [
  ['scanner', scannerWorker],
  ['metadata', metadataWorker],
  ['thumbnail', thumbnailWorker],
  ['video', videoWorker],
  ['smart-search', smartSearchWorker],
  ['face-detection', faceDetectionWorker],
  ['facial-recognition', facialRecognitionWorker],
  ['face-thumbnail', faceThumbnailWorker],
  ['og', ogWorker],
];

for (const [name, worker] of allWorkers) {
  if (worker) {
    worker.on('completed', (job) => {
      logger.info(`Task completed: ${name}/${job.name}`, { jobId: job.id });
    });
    worker.on('failed', (job, err) => {
      logger.error(`Task failed: ${name}/${job?.name || 'unknown'}`, { jobId: job?.id, error: err.message });
    });
  }
}

// Gracefully close all workers on shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}, closing workers...`);
  
  const closePromises = allWorkers
    .map(([_, worker]) => worker)
    .filter((worker): worker is Worker => worker !== undefined)
    .map(worker => worker.close());
    
  await Promise.all(closePromises);
  
  logger.info('Workers closed successfully.');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export {
  scannerQueue, scannerWorker,
  metadataQueue, metadataWorker,
  thumbnailQueue, thumbnailWorker,
  videoQueue, videoWorker,
  smartSearchQueue, smartSearchWorker,
  faceDetectionQueue, faceDetectionWorker,
  facialRecognitionQueue, facialRecognitionWorker,
  faceThumbnailQueue, faceThumbnailWorker,
  ogQueue, ogWorker,
  getExecutionMode, setExecutionMode, type QueueExecutionMode,
  dispatchMediaFile, type MediaJobData
};

export const queues: Record<string, Queue> = {
  'scanner': scannerQueue,
  'metadata': metadataQueue,
  'thumbnail': thumbnailQueue,
  'video': videoQueue,
  'smart-search': smartSearchQueue,
  'face-detection': faceDetectionQueue,
  'facial-recognition': facialRecognitionQueue,
  'face-thumbnail': faceThumbnailQueue,
  'og': ogQueue,
};
