import fs from 'fs';
import { execFile } from 'child_process';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { encode } from 'blurhash';
import { CacheTrackerService } from './cacheTracker.service';
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
    let cleanupTmp = false;
    const tmpPpmPath = path.join(CACHE_ROOT, `tmp_${mediaId}.ppm`);
    const tmpPngPath = path.join(CACHE_ROOT, `tmp_${mediaId}.png`);

    try {
      if (!fs.existsSync(fullPath)) {
        console.warn(`[MediaService] File does not exist on disk: ${fullPath}`);
        await query(
          `UPDATE media_files SET processing_error = 'FILE_NOT_FOUND', failed_attempts = COALESCE(failed_attempts, 0) + 1, updated_at = NOW() WHERE id = $1`,
          [mediaId]
        ).catch(() => {});
        return null;
      }

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

      const runHeicFallback = async () => {
        console.warn(`[MediaService] Sharp failed on HEIC, decoding primary image with libheif for ${fullPath}`);
        await new Promise<void>((resolve, reject) => {
          execFile('heic-primary-decode', [fullPath, tmpPpmPath], (error) => {
            if (error) {
              reject(new Error(`primary HEIC decode failed: ${error.message}`));
            } else {
              resolve();
            }
          });
        });
        
        await new Promise<void>((resolve, reject) => {
          execFile('ffmpeg', ['-y', '-i', tmpPpmPath, '-c:v', 'png', tmpPngPath], (error) => {
            if (error) {
              reject(new Error(`ffmpeg ppm to png failed: ${error.message}`));
            } else {
              resolve();
            }
          });
        });

        cleanupTmp = true;
        return tmpPngPath as string | Buffer;
      };

      // 1. Generate 1080p WebP preview (max 1920x1080, quality 80)
      let preview1080!: Buffer;
      try {
        preview1080 = await sharp(sharpInput, { unlimited: true })
          .resize({ width: 1920, height: 1080, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
      } catch (err: any) {
        if (!isHeic) {
          // If Sharp failed, attempt to extract high-res embedded preview from camera RAW (ARW, CR2, CR3, NEF, DNG, etc.)
          let rawExtracted = false;
          try {
            const rawFileBuf = await fs.promises.readFile(fullPath);
            let previewBuffer: Buffer | null = null;

            // 1. Try parsing IFD0 ThumbnailOffset & ThumbnailLength (Sony ARW / TIFF standard for HD preview)
            try {
              const exifrModule = await import('exifr');
              const exifr = exifrModule.default || exifrModule;
              const parsed = await exifr.parse(rawFileBuf.subarray(0, 512 * 1024), {
                tiff: true,
                mergeOutput: false
              });
              if (parsed?.ifd0?.ThumbnailOffset && parsed?.ifd0?.ThumbnailLength) {
                const offset = Number(parsed.ifd0.ThumbnailOffset);
                const len = Number(parsed.ifd0.ThumbnailLength);
                if (len > 20 * 1024 && offset + len <= rawFileBuf.length) {
                  previewBuffer = rawFileBuf.subarray(offset, offset + len);
                }
              }
            } catch {}

            // 2. Scan first 8MB for largest embedded JPEG stream (fallback if IFD0 tags absent)
            if (!previewBuffer) {
              const maxScan = Math.min(rawFileBuf.length, 8 * 1024 * 1024);
              let bestStart = -1;
              let bestLen = 0;
              let p = 0;
              while (p < maxScan - 4) {
                if (rawFileBuf[p] === 0xFF && rawFileBuf[p + 1] === 0xD8 && rawFileBuf[p + 2] === 0xFF) {
                  let eoi = -1;
                  for (let q = p + 2; q < maxScan - 1; q++) {
                    if (rawFileBuf[q] === 0xFF && rawFileBuf[q + 1] === 0xD9) {
                      eoi = q + 2;
                      break;
                    }
                  }
                  if (eoi !== -1) {
                    const len = eoi - p;
                    if (len > bestLen) {
                      bestLen = len;
                      bestStart = p;
                    }
                    p = eoi;
                    continue;
                  }
                }
                p++;
              }
              if (bestStart !== -1 && bestLen > 20 * 1024) {
                previewBuffer = rawFileBuf.subarray(bestStart, bestStart + bestLen);
              }
            }

            // 3. Fallback to standard exifr.thumbnail() if nothing larger was found
            if (!previewBuffer) {
              const exifrModule = await import('exifr');
              const exifr = exifrModule.default || exifrModule;
              const thumb = await exifr.thumbnail(rawFileBuf);
              previewBuffer = thumb ? Buffer.from(thumb) : null;
            }

            if (previewBuffer && previewBuffer.length > 0) {
              preview1080 = await sharp(previewBuffer, { unlimited: true })
                .resize({ width: 1920, height: 1080, fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 80 })
                .toBuffer();
              rawExtracted = true;
            }
          } catch (rawErr: any) {
            console.warn(`[MediaService] RAW preview extraction error for ${fullPath}:`, rawErr.message);
          }
          if (!rawExtracted) throw err;
        } else {
          sharpInput = await runHeicFallback();
          preview1080 = await sharp(sharpInput, { unlimited: true })
            .resize({ width: 1920, height: 1080, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();
        }
      }
      await fs.promises.writeFile(out1080, preview1080);
      CacheTrackerService.recordWrite('1080p', preview1080.length).catch(() => {});

      // 2. Generate 480p WebP thumbnail (max 854x480, quality 65)
      // Downscale the already-decoded preview instead of decoding the source again.
      const buffer480 = await sharp(preview1080, { unlimited: true })
        .resize({ width: 854, height: 480, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 65 })
        .toBuffer();
      
      await fs.promises.writeFile(out480, buffer480);
      CacheTrackerService.recordWrite('480p', buffer480.length).catch(() => {});

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
      const meta = await sharp(preview1080).metadata();
      const metaWidth = meta.width || null;
      const metaHeight = meta.height || null;

      await query(
        `UPDATE media_files 
         SET blurhash = $1, has_1080p = true, has_480p = true, 
             img_width = COALESCE(img_width, $3),
             img_height = COALESCE(img_height, $4),
             processing_error = NULL, updated_at = NOW() 
         WHERE id = $2`,
        [bHash, mediaId, metaWidth, metaHeight]
      );

      return { blurhash: bHash, has1080p: true, has480p: true };

    } catch (err: any) {
      console.error(`[MediaService] Failed to process image ${fullPath}:`, err.message);
      throw err;
    } finally {
      if (cleanupTmp) {
        try { if (fs.existsSync(tmpPpmPath)) fs.unlinkSync(tmpPpmPath); } catch {}
        try { if (fs.existsSync(tmpPngPath)) fs.unlinkSync(tmpPngPath); } catch {}
      }
    }
  }

  static async processVideo(mediaId: string, fullPath: string) {
    return VideoService.processVideo(mediaId, fullPath);
  }
}
