import { facialRecognitionQueue, faceThumbnailQueue } from './src/queue';
async function run() {
  console.log("Facial Recognition:", await facialRecognitionQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'));
  console.log("Face Thumbnail:", await faceThumbnailQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'));
  process.exit(0);
}
run();
