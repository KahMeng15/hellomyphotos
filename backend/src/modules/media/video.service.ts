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
      const dirMp4 = path.join(CACHE_ROOT, 'transcoded', 'mp4');
      const dirWebm = path.join(CACHE_ROOT, 'transcoded', 'webm');
      await fs.promises.mkdir(dir480, { recursive: true });
      await fs.promises.mkdir(dirMp4, { recursive: true });
      await fs.promises.mkdir(dirWebm, { recursive: true });

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

      // Transcode to MP4 (H.264) and WebM (VP8) for browser playback
      const mp4Out = path.join(dirMp4, `${mediaId}.mp4`);
      const webmOut = path.join(dirWebm, `${mediaId}.webm`);
      let isTranscoded = false;
      try {
        await Promise.all([
          new Promise<void>((resolve) => {
            ffmpeg(fullPath)
              .save(mp4Out)
              .videoCodec('libx264')
              .outputOptions(['-preset veryfast', '-pix_fmt yuv420p', '-movflags +faststart'])
              .on('end', () => resolve())
              .on('error', (err) => {
                console.warn(`[VideoService] MP4 transcode warning for ${fullPath}:`, err.message);
                resolve();
              });
          }),
          new Promise<void>((resolve) => {
            ffmpeg(fullPath)
              .save(webmOut)
              .videoCodec('libvpx')
              .outputOptions(['-b:v 1M', '-deadline realtime', '-cpu-used 5'])
              .on('end', () => resolve())
              .on('error', (err) => {
                console.warn(`[VideoService] WebM transcode warning for ${fullPath}:`, err.message);
                resolve();
              });
          })
        ]);
        isTranscoded = fs.existsSync(mp4Out) && fs.existsSync(webmOut);
        await query(
          `UPDATE media_files 
           SET is_transcoded = $1, transcoded_mp4_path = $2, transcoded_webm_path = $3, updated_at = NOW() 
           WHERE id = $4`,
          [isTranscoded, isTranscoded ? mp4Out : null, isTranscoded ? webmOut : null, mediaId]
        );
      } catch (err: any) {
        console.warn(`[VideoService] Transcoding failed for ${fullPath}:`, err.message);
      }

      return { has480p, blurhash: bHash, isTranscoded };

    } catch (err: any) {
      console.error(`[VideoService] Failed to process video ${fullPath}:`, err.message);
      throw err;
    }
  }
}
