import { MediaService } from '../src/modules/media/media.service';
import { queues } from '../src/queue';
import { redis } from '../src/config/redis';
import fs from 'fs';
import path from 'path';

async function runTest() {
  const testFile = '/app/media/PUBMED/Day 1/Photos/IMG_0419.HEIC';
  console.log('Testing MediaService on', testFile);
  
  if (!fs.existsSync(testFile)) {
    console.error('File not found:', testFile);
    process.exit(1);
  }

  try {
    const result = await MediaService.generateThumbnails(1, testFile, 'image/heic');
    console.log('Successfully processed HEIC:', result);
  } catch (err) {
    console.error('Failed to process HEIC:', err);
  } finally {
    await redis.quit();
    process.exit(0);
  }
}

runTest();
