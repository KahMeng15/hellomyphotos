import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { encode } from 'blurhash';
import { query } from '../../config/db';

const defaultCacheDir = fs.existsSync('/app/cache') ? '/app/cache' : path.resolve(process.cwd(), '../volumes/cache_rw');
const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || defaultCacheDir);

// Limit sharp memory usage in the video worker too
sharp.cache({ memory: 64, files: 0, items: 20 });
sharp.concurrency(1);

// Cache VAAPI availability so we don't probe /dev/dri on every video
let vaapiAvailable: boolean | null = null;
async function isVaapiAvailable(): Promise<boolean> {
  if (vaapiAvailable !== null) return vaapiAvailable;
  try {
    await fs.promises.access('/dev/dri/renderD128', fs.constants.R_OK);
    vaapiAvailable = true;
  } catch {
    vaapiAvailable = false;
  }
  console.log(`[VideoService] VAAPI hardware acceleration: ${vaapiAvailable ? 'ENABLED' : 'disabled (falling back to software)'}`);
  return vaapiAvailable;
}

// Transcode a single file to MP4 using VAAPI (h264_vaapi) if available, else libx264
function transcodeToMp4(inputPath: string, outputPath: string, useVaapi: boolean): Promise<void> {
  return new Promise((resolve) => {
    const cmd = ffmpeg(inputPath).save(outputPath);

    if (useVaapi) {
      cmd
        .inputOptions(['-hwaccel vaapi', '-hwaccel_device /dev/dri/renderD128'])
        .videoCodec('h264_vaapi')
        .outputOptions(['-vf format=nv12,hwupload', '-qp 23', '-movflags +faststart'])
        .on('end', () => resolve())
        .on('error', (err) => {
          // VAAPI failed mid-way — re-run with software fallback
          console.warn(`[VideoService] VAAPI MP4 encode failed (${err.message}), retrying with libx264`);
          transcodeToMp4Software(inputPath, outputPath).then(resolve).catch(() => resolve());
        });
    } else {
      cmd
        .videoCodec('libx264')
        .outputOptions(['-preset veryfast', '-pix_fmt yuv420p', '-movflags +faststart', '-crf 23'])
        .on('end', () => resolve())
        .on('error', (err) => {
          console.warn(`[VideoService] MP4 transcode warning for ${inputPath}:`, err.message);
          resolve();
        });
    }
  });
}

function transcodeToMp4Software(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve) => {
    ffmpeg(inputPath)
      .save(outputPath)
      .videoCodec('libx264')
      .outputOptions(['-preset veryfast', '-pix_fmt yuv420p', '-movflags +faststart', '-crf 23'])
      .on('end', () => resolve())
      .on('error', () => resolve());
  });
}

// WebM transcoding is always software — VP9 VAAPI is unreliable.
// Run sequentially AFTER MP4 to avoid CPU contention with VAAPI.
function transcodeToWebm(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve) => {
    ffmpeg(inputPath)
      .save(outputPath)
      .videoCodec('libvpx')
      .outputOptions(['-b:v 1M', '-deadline realtime', '-cpu-used 5'])
      .on('end', () => resolve())
      .on('error', (err) => {
        console.warn(`[VideoService] WebM transcode warning for ${inputPath}:`, err.message);
        resolve();
      });
  });
}

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

      // 1. Extract a frame thumbnail using ffmpeg
      await new Promise<void>((resolve) => {
        ffmpeg(fullPath)
          .screenshots({ timestamps: ['10%'], filename: tempFrameFile, folder: dir480, size: '854x480' })
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
        `UPDATE media_files SET has_480p = $1, blurhash = COALESCE(blurhash, $2), updated_at = NOW() WHERE id = $3`,
        [has480p, bHash, mediaId]
      );

      // 2. Transcode: MP4 first (VAAPI if available), then WebM (always software, sequential)
      const mp4Out = path.join(dirMp4, `${mediaId}.mp4`);
      const webmOut = path.join(dirWebm, `${mediaId}.webm`);
      let isTranscoded = false;

      try {
        const useVaapi = await isVaapiAvailable();
        // Sequential — avoids two CPU-heavy ffmpeg processes competing simultaneously
        await transcodeToMp4(fullPath, mp4Out, useVaapi);
        await transcodeToWebm(fullPath, webmOut);

        isTranscoded = fs.existsSync(mp4Out) && fs.existsSync(webmOut);
        await query(
          `UPDATE media_files SET is_transcoded = $1, transcoded_mp4_path = $2, transcoded_webm_path = $3, updated_at = NOW() WHERE id = $4`,
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
