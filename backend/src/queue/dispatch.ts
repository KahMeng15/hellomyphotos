import { metadataQueue } from './metadataQueue';
import { videoQueue } from './videoQueue';
import { thumbnailQueue } from './thumbnailQueue';
import { smartSearchQueue } from './smartSearchQueue';
import { faceDetectionQueue } from './faceDetectionQueue';
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
    // NOTE: face-thumbnail is NOT dispatched here.
    // In concurrent mode, face-detection runs independently and chains:
    //   face-detection → facial-recognition → face-thumbnail
    // Dispatching face-thumbnail here would race face-detection and generate empty thumbnails.
    if (!isVideo) {
      promises.push(faceDetectionQueue.add('detect-faces', jobData));
    }
    await Promise.all(promises);
  }
}
