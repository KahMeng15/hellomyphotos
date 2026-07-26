import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { encode } from 'blurhash';
import { query } from '../../config/db';

const defaultCacheDir = fs.existsSync('/app/cache') ? '/app/cache' : path.resolve(process.cwd(), 'volumes/cache_rw');
const CACHE_ROOT = process.env.CACHE_ROOT || defaultCacheDir;

export class VideoService {
  static async processVideo(mediaId: string, fullPath: string) {
    try {
      const videoDir = path.join(CACHE_ROOT, 'video');
      const dir480 = path.join(CACHE_ROOT, '480p');
      const mp4Dir = path.join(CACHE_ROOT, 'transcoded', 'mp4');
      const webmDir = path.join(CACHE_ROOT, 'transcoded', 'webm');

      await fs.promises.mkdir(videoDir, { recursive: true });
      await fs.promises.mkdir(dir480, { recursive: true });
      await fs.promises.mkdir(mp4Dir, { recursive: true });
      await fs.promises.mkdir(webmDir, { recursive: true });

      const mp4Out = path.join(videoDir, `${mediaId}.mp4`);
      const webmOut = path.join(videoDir, `${mediaId}.webm`);
      const mp4TranscodedOut = path.join(mp4Dir, `${mediaId}.mp4`);
      const webmTranscodedOut = path.join(webmDir, `${mediaId}.webm`);

      const thumb480Out = path.join(dir480, `${mediaId}.webp`);
      const tempFrameFile = `temp_frame_${mediaId}.png`;
      const tempFramePath = path.join(dir480, tempFrameFile);

      // 1. Generate 480p preview frame thumbnail & Blurhash
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

      // 2. Transcode input video into MP4 format
      let mp4Success = false;
      try {
        await new Promise<void>((resolve, reject) => {
          ffmpeg(fullPath)
            .output(mp4Out)
            .videoCodec('libx264')
            .audioCodec('aac')
            .format('mp4')
            .outputOptions(['-preset ultrafast', '-pix_fmt yuv420p', '-movflags +faststart'])
            .on('end', () => resolve())
            .on('error', (err) => {
              console.error(`[VideoService] MP4 transcode error for ${fullPath}:`, err.message);
              reject(err);
            })
            .run();
        });
        mp4Success = fs.existsSync(mp4Out);
        if (mp4Success) {
          try { await fs.promises.copyFile(mp4Out, mp4TranscodedOut); } catch (e) {}
        }
      } catch (err: any) {
        console.error(`[VideoService] MP4 transcode failed for ${fullPath}:`, err.message);
      }

      // 3. Transcode input video into WebM format
      let webmSuccess = false;
      try {
        await new Promise<void>((resolve, reject) => {
          ffmpeg(fullPath)
            .output(webmOut)
            .videoCodec('libvpx')
            .format('webm')
            .outputOptions(['-preset ultrafast'])
            .on('end', () => resolve())
            .on('error', (err) => {
              console.error(`[VideoService] WebM transcode error for ${fullPath}:`, err.message);
              reject(err);
            })
            .run();
        });
        webmSuccess = fs.existsSync(webmOut);
        if (webmSuccess) {
          try { await fs.promises.copyFile(webmOut, webmTranscodedOut); } catch (e) {}
        }
      } catch (err: any) {
        console.error(`[VideoService] WebM transcode failed for ${fullPath}:`, err.message);
      }

      const isTranscoded = mp4Success && webmSuccess;

      // 4. Update media_files database table
      await query(
        `UPDATE media_files 
         SET is_transcoded = $1, transcoded_mp4_path = $2, transcoded_webm_path = $3, has_480p = $4, blurhash = COALESCE(blurhash, $5), updated_at = NOW() 
         WHERE id = $6`,
        [isTranscoded, isTranscoded ? mp4Out : null, isTranscoded ? webmOut : null, has480p, bHash, mediaId]
      );

      if (!isTranscoded) {
        throw new Error(`Video transcoding failed for ${fullPath}`);
      }

      return {
        isTranscoded,
        transcodedMp4Path: mp4Out,
        transcodedWebmPath: webmOut,
        has480p,
        blurhash: bHash
      };

    } catch (err: any) {
      console.error(`[VideoService] Failed to process video ${fullPath}:`, err.message);
      throw err;
    }
  }
}
