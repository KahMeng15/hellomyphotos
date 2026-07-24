import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { encode } from 'blurhash';
import { query } from '../../config/db';
import { mlQueue } from '../../queue/mlQueue';

const CACHE_ROOT = process.env.CACHE_ROOT || '/app/cache';

// Ensure cache dirs exist
fs.mkdirSync(path.join(CACHE_ROOT, '1080p'), { recursive: true });
fs.mkdirSync(path.join(CACHE_ROOT, '480p'), { recursive: true });

export class MediaService {
  static async processImage(mediaId: string, fullPath: string) {
    try {
      // 1. Generate 1080p WebP (High Quality Preview, strip metadata)
      const out1080 = path.join(CACHE_ROOT, '1080p', `${mediaId}.webp`);
      await sharp(fullPath)
        .resize({ width: 1920, height: 1080, fit: 'inside', withoutEnlargement: true })
        .withMetadata(false)
        .webp({ quality: 80 })
        .toFile(out1080);

      // 2. Generate 480p WebP (Low Bandwidth Mobile Preview)
      const out480 = path.join(CACHE_ROOT, '480p', `${mediaId}.webp`);
      const buffer480 = await sharp(fullPath)
        .resize({ width: 854, height: 480, fit: 'inside', withoutEnlargement: true })
        .withMetadata(false)
        .webp({ quality: 65 })
        .toBuffer();
      await fs.promises.writeFile(out480, buffer480);

      // 3. Generate Blurhash (very small raw buffer for hashing)
      const rawImage = await sharp(buffer480)
        .raw()
        .ensureAlpha()
        .resize(32, 32, { fit: 'inside' })
        .toBuffer({ resolveWithObject: true });

      const bHash = encode(
        new Uint8ClampedArray(rawImage.data),
        rawImage.info.width,
        rawImage.info.height,
        4, 3
      );

      // Save Blurhash to DB
      await query(`UPDATE media_files SET blurhash = $1 WHERE id = $2`, [bHash, mediaId]);

      // Push job to Facial Recognition Queue
      await mlQueue.add('detect-faces', { mediaId });

    } catch (err: any) {
      console.error(`Failed to process image ${fullPath}:`, err.message);
    }
  }

  static async processVideo(mediaId: string, fullPath: string) {
    return new Promise<void>((resolve, reject) => {
      const out480 = path.join(CACHE_ROOT, '480p', `${mediaId}.webp`);
      
      ffmpeg(fullPath)
        .screenshots({
          timestamps: ['10%'],
          filename: `${mediaId}.webp`,
          folder: path.join(CACHE_ROOT, '480p'),
          size: '?x480'
        })
        .on('end', async () => {
          // You could optionally create a 1080p and Blurhash from this extracted frame
          resolve();
        })
        .on('error', (err) => {
          console.error(`Failed to process video ${fullPath}:`, err.message);
          reject(err);
        });
    });
  }
}
