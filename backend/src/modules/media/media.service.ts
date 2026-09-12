import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { encode } from 'blurhash';
import { query } from '../../config/db';
import { VideoService } from './video.service';

const defaultCacheDir = fs.existsSync('/app/cache') ? '/app/cache' : path.resolve(process.cwd(), '../volumes/cache_rw');
const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || defaultCacheDir);

// Limit sharp's internal libvips cache and concurrency to prevent memory spikes.
// BullMQ's THUMBNAIL_CONCURRENCY env var controls parallelism at the job level.
sharp.cache({ memory: 64, files: 0, items: 20 });
sharp.concurrency(1);

// Ensure cache dirs exist
fs.mkdirSync(path.join(CACHE_ROOT, '1080p'), { recursive: true });
fs.mkdirSync(path.join(CACHE_ROOT, '480p'), { recursive: true });
fs.mkdirSync(path.join(CACHE_ROOT, 'transcoded', 'mp4'), { recursive: true });
fs.mkdirSync(path.join(CACHE_ROOT, 'transcoded', 'webm'), { recursive: true });

export class MediaService {
  static async processImage(mediaId: string, fullPath: string) {
    try {
      const dir1080 = path.join(CACHE_ROOT, '1080p');
      const dir480 = path.join(CACHE_ROOT, '480p');
      await fs.promises.mkdir(dir1080, { recursive: true });
      await fs.promises.mkdir(dir480, { recursive: true });

      const out1080 = path.join(dir1080, `${mediaId}.webp`);
      const out480 = path.join(dir480, `${mediaId}.webp`);

      let sharpInput: string | Buffer = fullPath;
      const isHeic = fullPath.toLowerCase().endsWith('.heic') || fullPath.toLowerCase().endsWith('.heif');
      if (isHeic) {
        sharpInput = await fs.promises.readFile(fullPath);
      }

      let cleanupTmp = false;
      const tmpPngPath = path.join(CACHE_ROOT, `tmp_${mediaId}.png`);

      const runFfmpegFallback = async () => {
        console.warn(`[MediaService] Sharp failed on HEIC, falling back to ffmpeg for ${fullPath}`);
        await new Promise<void>((resolve, reject) => {
          ffmpeg(fullPath)
            .outputOptions(['-vframes 1', '-q:v 2'])
            .save(tmpPngPath)
            .on('end', () => resolve())
            .on('error', (e) => reject(e));
        });
        cleanupTmp = true;
        return tmpPngPath as string | Buffer;
      };

      // 1. Generate 1080p WebP preview (max 1920x1080, quality 80)
      let out1080Done = false;
      try {
        await sharp(sharpInput, { unlimited: true })
          .resize({ width: 1920, height: 1080, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(out1080);
        out1080Done = true;
      } catch (err: any) {
        if (!isHeic) throw err;
        sharpInput = await runFfmpegFallback();
        await sharp(sharpInput, { unlimited: true })
          .resize({ width: 1920, height: 1080, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(out1080);
        out1080Done = true;
      }

      // 2. Generate 480p WebP thumbnail (max 854x480, quality 65)
      // Note: if ffmpeg fallback already ran, sharpInput is now the PNG path
      const buffer480 = await sharp(sharpInput, { unlimited: true })
        .resize({ width: 854, height: 480, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 65 })
        .toBuffer();
      
      await fs.promises.writeFile(out480, buffer480);

      // 3. Calculate Blurhash string using sharp and blurhash library
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

      // 4. Save blurhash, has_1080p, has_480p status to media_files DB table
      await query(
        `UPDATE media_files 
         SET blurhash = $1, has_1080p = true, has_480p = true, updated_at = NOW() 
         WHERE id = $2`,
        [bHash, mediaId]
      );

      if (cleanupTmp) {
        fs.unlink(tmpPngPath, () => {});
      }

      return { blurhash: bHash, has1080p: true, has480p: true };

    } catch (err: any) {
      console.error(`[MediaService] Failed to process image ${fullPath}:`, err.message);
      throw err;
    }
  }

  static async processVideo(mediaId: string, fullPath: string) {
    return VideoService.processVideo(mediaId, fullPath);
  }
}
