import { metadataQueue } from './metadataQueue';
import { videoQueue } from './videoQueue';
import { thumbnailQueue } from './thumbnailQueue';
import { smartSearchQueue } from './smartSearchQueue';
import { faceDetectionQueue } from './faceDetectionQueue';
import { facialRecognitionQueue } from './facialRecognitionQueue';
import { faceThumbnailQueue } from './faceThumbnailQueue';
import { getExecutionMode } from './mode';

export interface MediaJobData {
  mediaId: string;
  fullPath: string;
  mimeType: string;
}

export async function dispatchMediaFile(jobData: MediaJobData): Promise<void> {
  const mode = await getExecutionMode();
  if (mode === 'sequential') {
    await metadataQueue.add('extract-metadata', jobData);
  } else {
    const isVideo = jobData.mimeType?.startsWith('video/');
    const promises: Promise<any>[] = [
      metadataQueue.add('extract-metadata', jobData),
      isVideo
        ? videoQueue.add('process-video', jobData)
        : thumbnailQueue.add('generate-thumbnail', jobData),
      smartSearchQueue.add('generate-smart-search', jobData),
    ];
    if (!isVideo) {
      promises.push(faceDetectionQueue.add('detect-faces', jobData));
      promises.push(facialRecognitionQueue.add('recognize-faces', jobData));
      promises.push(faceThumbnailQueue.add('generate-face-thumbnails', { mediaId: jobData.mediaId }));
    }
    await Promise.all(promises);
  }
}
