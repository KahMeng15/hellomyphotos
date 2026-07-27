import { Queue } from 'bullmq';
import { scannerQueue, scannerWorker } from './scannerQueue';
import { metadataQueue, metadataWorker } from './metadataQueue';
import { thumbnailQueue, thumbnailWorker } from './thumbnailQueue';
import { videoQueue, videoWorker } from './videoQueue';
import { smartSearchQueue, smartSearchWorker } from './smartSearchQueue';
import { faceDetectionQueue, faceDetectionWorker } from './faceDetectionQueue';
import { facialRecognitionQueue, facialRecognitionWorker } from './facialRecognitionQueue';
import { faceThumbnailQueue, faceThumbnailWorker } from './faceThumbnailQueue';
import { getExecutionMode, setExecutionMode, type QueueExecutionMode } from './mode';

import { dispatchMediaFile, MediaJobData } from './dispatch';

export {
  scannerQueue, scannerWorker,
  metadataQueue, metadataWorker,
  thumbnailQueue, thumbnailWorker,
  videoQueue, videoWorker,
  smartSearchQueue, smartSearchWorker,
  faceDetectionQueue, faceDetectionWorker,
  facialRecognitionQueue, facialRecognitionWorker,
  faceThumbnailQueue, faceThumbnailWorker,
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
};

