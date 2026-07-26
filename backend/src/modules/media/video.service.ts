import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { encode } from 'blurhash';
import { query } from '../../config/db';

const defaultCacheDir = fs.existsSync('/app/cache') ? '/app/cache' : path.resolve(process.cwd(), '../volumes/cache_rw');
const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || defaultCacheDir);

export class VideoService {
  static async processVideo(mediaId: string, fullPath: string) {
    try {
      const dir480 = path.join(CACHE_ROOT, '480p');
      await fs.promises.mkdir(dir480, { recursive: true });

      const thumb480Out = path.join(dir480, `${mediaId}.webp`);
      const tempFrameFile = `temp_frame_${mediaId}.png`;
      const tempFramePath = path.join(dir480, tempFrameFile);

      let has480p = false;
      let bHash: string | null = null;

      await new Promise<void>((resolve) => {
        ffmpeg(fullPath)
          .screenshots({
            timestamps: ['10%'],
            filename: tempFrameFile,
            folder: dir480,
            size: '854x480'
          })
          .on('end', () => resolve())
          .on('error', (err) => {
            console.warn(`[VideoService] Screenshot extraction warning for ${fullPath}:`, err.message);
            resolve();
          });
      });

      if (fs.existsSync(tempFramePath)) {
        try {
          const buffer480 = await sharp(tempFramePath)
            .resize({ width: 854, height: 480, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 65 })
            .toBuffer();

          await fs.promises.writeFile(thumb480Out, buffer480);
          has480p = true;

          const rawImage = await sharp(buffer480)
            .raw()
            .ensureAlpha()
            .resize(32, 32, { fit: 'inside' })
            .toBuffer({ resolveWithObject: true });

          bHash = encode(
            new Uint8ClampedArray(rawImage.data),
            rawImage.info.width,
            rawImage.info.height,
            4, 3
          );
        } catch (err: any) {
          console.warn(`[VideoService] Frame processing warning for ${fullPath}:`, err.message);
        } finally {
          try { await fs.promises.unlink(tempFramePath); } catch (e) {}
        }
      }

      await query(
        `UPDATE media_files 
         SET has_480p = $1, blurhash = COALESCE(blurhash, $2), updated_at = NOW() 
         WHERE id = $3`,
        [has480p, bHash, mediaId]
      );

      return { has480p, blurhash: bHash };

    } catch (err: any) {
      console.error(`[VideoService] Failed to process video ${fullPath}:`, err.message);
      throw err;
    }
  }
}
