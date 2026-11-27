import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import util from 'util';
import { execFile } from 'child_process';
const execFileAsync = util.promisify(execFile);
import { query } from '../../config/db';
import { AnalyticsService } from '../analytics/analytics.service';
import { WatermarkService } from './watermark.service';
import { CacheTrackerService } from './cacheTracker.service';

const defaultCacheDir = fs.existsSync('/app/cache') ? '/app/cache' : path.resolve(process.cwd(), '../volumes/cache_rw');
const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || defaultCacheDir);

const defaultMediaDir = fs.existsSync('/app/media') ? '/app/media' : path.resolve(process.cwd(), '../volumes/media_ro');
const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || defaultMediaDir);
import { resolveMediaFullPath } from '../../utils/mediaPath';

import { verifyMediaAccess, requireAuth, hasFolderAccess } from '../../utils/auth';
import { thumbnailQueue } from '../../queue/thumbnailQueue';
import { videoQueue } from '../../queue/videoQueue';
import { getClientIp } from '../../utils/getIp';

import { getThrottleLimits, BandwidthThrottler } from '../../utils/throttle';
async function sendThrottled(request: FastifyRequest, reply: FastifyReply, stream: NodeJS.ReadableStream | Buffer) {
  const isAuth = (request as any).user != null;
  const ip = request.ip || 'unknown';
  const limits = await getThrottleLimits();
  const globalLimit = isAuth ? limits.authGlobalLimit : limits.publicGlobalLimit;
  if ((globalLimit > 0 || (isAuth ? limits.authLimit : limits.publicLimit) > 0) && typeof (stream as any).pipe === 'function') {
    return reply.send((stream as any).pipe(new BandwidthThrottler(ip, isAuth)));
  }
  return reply.send(stream);
}

export async function mediaRoutes(fastify: FastifyInstance) {
  
  fastify.get<{ Params: { id: string }, Querystring: { shareToken?: string } }>('/api/media/:id/thumbnail', async (request, reply) => {
    const { id } = request.params;
    const safeId = path.basename(id).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeId || safeId !== id) return reply.status(400).send({ error: 'Invalid ID' });
    
    if (!(await verifyMediaAccess(request, reply, safeId))) return;

    const { shareToken } = request.query;

    const effectiveTemplate = await WatermarkService.getEffectiveTemplateForShare(shareToken);
    const shouldWatermark = Boolean(effectiveTemplate?.apply_to_previews);

    if (shouldWatermark && effectiveTemplate) {
      const tplVersion = effectiveTemplate.updated_at ? new Date(effectiveTemplate.updated_at).getTime() : 0;
      const wmCacheDir = path.resolve(CACHE_ROOT, 'watermark_previews');
      if (!fs.existsSync(wmCacheDir)) {
        fs.mkdirSync(wmCacheDir, { recursive: true });
      }

      // Check if we already have the watermarked thumbnail cached
      const is500px = !effectiveTemplate.allow_hd_download && effectiveTemplate.restricted_tier === '500px';
      const wmThumbPath = is500px 
        ? path.resolve(wmCacheDir, `${safeId}_${effectiveTemplate.id}_${tplVersion}.webp`)
        : path.resolve(wmCacheDir, `${safeId}_${effectiveTemplate.id}_${tplVersion}_thumb.webp`);

      const etag = `"${safeId}-${effectiveTemplate.id}-${tplVersion}-thumb"`;
      reply.header('ETag', etag);
      reply.header('Cache-Control', 'private, no-cache');

      if (request.headers['if-none-match'] === etag) {
        return reply.status(304).send();
      }

      if (fs.existsSync(wmThumbPath)) {
        reply.header('Content-Type', 'image/webp');
        return sendThrottled(request, reply, fs.createReadStream(wmThumbPath));
      }

      // Base image is 480p
      let baseDir = path.resolve(CACHE_ROOT, '480p');
      let baseImgPath = path.resolve(baseDir, `${safeId}.webp`);
      if (!fs.existsSync(baseImgPath)) {
        baseImgPath = path.resolve(CACHE_ROOT, '1080p', `${safeId}.webp`);
      }

      if (fs.existsSync(baseImgPath)) {
        reply.header('Content-Type', 'image/webp');
        const metaRes = await query(
          `SELECT file_name, folder_path, created_at, 
                  exif_json->>'Make' as camera_make, 
                  exif_json->>'Model' as camera_model, 
                  exif_json->>'LensModel' as lens_model, 
                  exif_json->>'ISO' as iso, 
                  exif_json->>'ExposureTime' as shutter_speed, 
                  exif_json->>'FNumber' as f_number, 
                  exif_json->>'Copyright' as copyright 
           FROM media_files WHERE id = $1`,
          [safeId]
        );
        const buffer = await WatermarkService.addWatermarkToStream(baseImgPath, effectiveTemplate, metaRes.rows[0], 'webp');
        fs.promises.writeFile(wmThumbPath, buffer).catch((err) => {
          console.error('[WatermarkCache] Write error:', err);
        });
        return sendThrottled(request, reply, buffer);
      }
    }

    const cache480Dir = path.resolve(CACHE_ROOT, '480p');
    const filePath = path.resolve(cache480Dir, `${safeId}.webp`);
    if (!filePath.startsWith(cache480Dir + path.sep)) {
      return reply.status(400).send({ error: 'Invalid ID' });
    }
    
    if (fs.existsSync(filePath)) {
      const etag = `"${safeId}-480p"`;
      reply.header('ETag', etag);
      if (request.headers['if-none-match'] === etag) {
        return reply.status(304).send();
      }
      reply.header('Content-Type', 'image/webp');
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return sendThrottled(request, reply, fs.createReadStream(filePath));
    }
    
    // Fallback: serve original if processing isn't done (for images only)
    const result = await query(`SELECT folder_path, file_name, mime_type FROM media_files WHERE id = $1`, [safeId]);
    if (result.rows.length > 0) {
      const file = result.rows[0];
      const fullPath = resolveMediaFullPath(file.folder_path, file.file_name);
      
      // Enqueue high-priority job for missing thumbnail
      if (file.mime_type.startsWith('video/')) {
        await videoQueue.add('process-video', { mediaId: safeId, fullPath, mimeType: file.mime_type }, { priority: 1 }).catch(() => {});
      } else if (file.mime_type.startsWith('image/')) {
        await thumbnailQueue.add('generate-thumbnail', { mediaId: safeId, fullPath, mimeType: file.mime_type }, { priority: 1 }).catch(() => {});
      }

      if (fs.existsSync(fullPath) && file.mime_type.startsWith('image/')) {
        const stats = fs.statSync(fullPath);
        // Only serve original as a thumbnail if it is less than 1MB to prevent network stalling on 4G
        if (stats.size < 1024 * 1024) {
          reply.header('Content-Type', file.mime_type);
          reply.header('Cache-Control', 'public, max-age=30'); // Short cache so they upgrade to webp later
          return sendThrottled(request, reply, fs.createReadStream(fullPath));
        }
      }

      // For media still being processed: return 202 so browsers know to retry
      reply.header('Cache-Control', 'no-cache');
      reply.header('Retry-After', '5');
      return reply.status(202).send({ message: 'Thumbnail is being generated, please retry shortly' });
    }

    return reply.status(404).send({ error: 'Thumbnail not found' });
  });

  fastify.get<{ Params: { id: string }, Querystring: { watermark?: string, shareToken?: string, context?: string } }>('/api/media/:id/preview', async (request, reply) => {
    const { id } = request.params;
    const safeId = path.basename(id).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeId || safeId !== id) return reply.status(400).send({ error: 'Invalid ID' });
    
    if (!(await verifyMediaAccess(request, reply, safeId))) return;

    const { watermark, shareToken, context } = request.query;
    
    if (context === 'lightbox') {
      AnalyticsService.logView(safeId, 'VIEW_1080P', 120000, shareToken);
      AnalyticsService.logVisit({
        mediaId: safeId,
        shareToken,
        actionType: 'preview',
        ip: getClientIp(request),
        userAgent: request.headers['user-agent'] as string | undefined,
        referrer: request.headers.referer as string | undefined,
        path: request.url
      });
    }

    const effectiveTemplate = await WatermarkService.getEffectiveTemplateForShare(shareToken);
    const shouldWatermark = (watermark === 'true') || Boolean(effectiveTemplate?.apply_to_previews);

    const cache1080Dir = path.resolve(CACHE_ROOT, '1080p');
    const cache480Dir = path.resolve(CACHE_ROOT, '480p');

    // Pick source tier: if HD is restricted and tier is 500px, use 480p for preview
    let baseDir = cache1080Dir;
    if (effectiveTemplate && !effectiveTemplate.allow_hd_download && effectiveTemplate.restricted_tier === '500px') {
      baseDir = cache480Dir;
    }

    let filePath = path.resolve(baseDir, `${safeId}.webp`);
    if (!fs.existsSync(filePath)) {
      filePath = path.resolve(cache1080Dir, `${safeId}.webp`);
      if (!fs.existsSync(filePath)) {
        filePath = path.resolve(cache480Dir, `${safeId}.webp`);
      }
    }

    if (fs.existsSync(filePath)) {
      reply.header('Content-Type', 'image/webp');

      if (shouldWatermark && effectiveTemplate) {
        const tplVersion = effectiveTemplate.updated_at ? new Date(effectiveTemplate.updated_at).getTime() : 0;
        const wmCacheDir = path.resolve(CACHE_ROOT, 'watermark_previews');
        if (!fs.existsSync(wmCacheDir)) {
          fs.mkdirSync(wmCacheDir, { recursive: true });
        }
        const wmCachedPath = path.resolve(wmCacheDir, `${safeId}_${effectiveTemplate.id}_${tplVersion}.webp`);

        const etag = `"${safeId}-${effectiveTemplate.id}-${tplVersion}"`;
        reply.header('ETag', etag);
        reply.header('Cache-Control', 'private, no-cache');

        if (request.headers['if-none-match'] === etag) {
          return reply.status(304).send();
        }

        if (fs.existsSync(wmCachedPath)) {
          return sendThrottled(request, reply, fs.createReadStream(wmCachedPath));
        }

        const metaRes = await query(
          `SELECT file_name, folder_path, created_at, 
                  exif_json->>'Make' as camera_make, 
                  exif_json->>'Model' as camera_model, 
                  exif_json->>'LensModel' as lens_model, 
                  exif_json->>'ISO' as iso, 
                  exif_json->>'ExposureTime' as shutter_speed, 
                  exif_json->>'FNumber' as f_number, 
                  exif_json->>'Copyright' as copyright 
           FROM media_files WHERE id = $1`,
          [safeId]
        );
        const buffer = await WatermarkService.addWatermarkToStream(filePath, effectiveTemplate, metaRes.rows[0], 'webp');
        fs.promises.writeFile(wmCachedPath, buffer).catch((err) => {
          console.error('[WatermarkCache] Write error:', err);
        });
        CacheTrackerService.recordWrite('watermark_previews', buffer.length).catch(() => {});
        return sendThrottled(request, reply, buffer);
      } else {
        const etag = `"${safeId}-1080p"`;
        reply.header('ETag', etag);
        if (request.headers['if-none-match'] === etag) {
          return reply.status(304).send();
        }
        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        return sendThrottled(request, reply, fs.createReadStream(filePath));
      }
    }
    // Fallback to 480p if 1080p isn't ready or doesn't exist (e.g. video thumbs)
    const fallback = path.resolve(cache480Dir, `${safeId}.webp`);
    if (!fallback.startsWith(cache480Dir + path.sep)) {
      return reply.status(400).send({ error: 'Invalid ID' });
    }
    if (fs.existsSync(fallback)) {
      const etag = `"${safeId}-480p"`;
      reply.header('ETag', etag);
      if (request.headers['if-none-match'] === etag) {
        return reply.status(304).send();
      }
      reply.header('Content-Type', 'image/webp');
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return sendThrottled(request, reply, fs.createReadStream(fallback));
    }
    
    // Fallback to original image
    const result = await query(`SELECT folder_path, file_name, mime_type FROM media_files WHERE id = $1`, [safeId]);
    if (result.rows.length > 0) {
      const file = result.rows[0];
      const fullPath = resolveMediaFullPath(file.folder_path, file.file_name);
      
      // Enqueue high-priority job for missing preview
      if (file.mime_type.startsWith('video/')) {
        await videoQueue.add('process-video', { mediaId: safeId, fullPath, mimeType: file.mime_type }, { priority: 1 }).catch(() => {});
      } else if (file.mime_type.startsWith('image/')) {
        await thumbnailQueue.add('generate-thumbnail', { mediaId: safeId, fullPath, mimeType: file.mime_type }, { priority: 1 }).catch(() => {});
      }

      if (fs.existsSync(fullPath) && file.mime_type.startsWith('image/')) {
        reply.header('Content-Type', file.mime_type);
        reply.header('Cache-Control', 'public, max-age=30'); // Short cache
        return sendThrottled(request, reply, fs.createReadStream(fullPath));
      }
    }

    return reply.status(404).send({ error: 'Preview not found' });
  });

  fastify.get<{ Params: { id: string }, Querystring: { download?: string, shareToken?: string } }>('/api/media/:id/stream', async (request, reply) => {
    const { id } = request.params;

    if (!(await verifyMediaAccess(request, reply, id))) return;

    const { download, watermark, shareToken } = request.query as any;
    const result = await query(
      `SELECT folder_path, file_name, mime_type, size_bytes,
              is_transcoded, transcoded_mp4_path, transcoded_webm_path,
              created_at,
              exif_json->>'DateTimeOriginal' as captured_at,
              exif_json->>'Make' as camera_make,
              exif_json->>'Model' as camera_model,
              exif_json->>'LensModel' as lens_model,
              exif_json->>'ISO' as iso,
              exif_json->>'ExposureTime' as shutter_speed,
              exif_json->>'FNumber' as f_number,
              exif_json->>'Copyright' as copyright
       FROM media_files WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) return reply.status(404).send({ error: 'File not found' });
    
    const file = result.rows[0];
    const fullPath = resolveMediaFullPath(file.folder_path, file.file_name);
    
    if (!fs.existsSync(fullPath)) return reply.status(404).send({ error: 'Source file missing' });

    // Log a visit only for explicit downloads (range-request video streaming would be too noisy)
    if (download === '1' || download === 'true') {
      AnalyticsService.logVisit({
        mediaId: id,
        shareToken,
        actionType: 'download',
        ip: getClientIp(request),
        userAgent: request.headers['user-agent'] as string | undefined,
        referrer: request.headers.referer as string | undefined,
        path: request.url
      });
    }

    const effectiveTemplate = await WatermarkService.getEffectiveTemplateForShare(shareToken);

    // Explicit download handling
    if (download === '1' || download === 'true') {
      if (effectiveTemplate && file.mime_type.startsWith('image/')) {
        let serveImagePath = fullPath;
        let outFileName = file.file_name;

        // If HD download is forbidden, downgrade to restricted tier (1080p or 500px)
        if (!effectiveTemplate.allow_hd_download) {
          const tier = effectiveTemplate.restricted_tier || '1080p';
          const cacheTierDir = path.resolve(CACHE_ROOT, tier === '500px' ? '480p' : '1080p');
          const safeId = path.basename(id);
          const tierPath = path.resolve(cacheTierDir, `${safeId}.webp`);
          if (tierPath.startsWith(cacheTierDir) && fs.existsSync(tierPath)) {
            serveImagePath = tierPath;
            const ext = file.file_name.match(/\.[^/.]+$/)?.[0] || '.jpg';
            outFileName = `${file.file_name.replace(/\.[^/.]+$/, '')}_${tier}${ext}`;
          }
        }

        reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(outFileName)}"`);

        if (effectiveTemplate.apply_to_downloads) {
          reply.header('Cache-Control', 'private, no-store');
          const buffer = await WatermarkService.addWatermarkToStream(serveImagePath, effectiveTemplate, file);
          const isJpg = outFileName.match(/\.jpe?g$/i);
          const isPng = outFileName.match(/\.png$/i);
          reply.header('Content-Type', isJpg ? 'image/jpeg' : (isPng ? 'image/png' : 'image/webp'));
          reply.header('Content-Length', buffer.length);
          return sendThrottled(request, reply, buffer);
        } else if (!effectiveTemplate.allow_hd_download) {
          reply.header('Cache-Control', 'private, no-store');
          reply.header('Content-Type', 'image/webp');
          return sendThrottled(request, reply, fs.createReadStream(serveImagePath));
        }
      }

      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.file_name)}"`);
    } else {
      reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(file.file_name)}"`);
      // Inline stream preview: apply watermark if enabled
      if (effectiveTemplate && effectiveTemplate.apply_to_previews && file.mime_type.startsWith('image/')) {
        reply.header('Cache-Control', 'private, no-store');
        const buffer = await WatermarkService.addWatermarkToStream(fullPath, effectiveTemplate, file);
        return sendThrottled(request, reply, buffer);
      }
    }

    // --- Prefer transcoded MP4 for video streaming (not for explicit downloads) ---
    const isVideo = file.mime_type.startsWith('video/');
    const isExplicitDownload = download === '1' || download === 'true';

    if (isVideo && !isExplicitDownload && file.is_transcoded) {
      // Pick the best transcoded file available
      const mp4Path: string | null = file.transcoded_mp4_path;
      const servePath = mp4Path && fs.existsSync(mp4Path) ? mp4Path : null;

      if (servePath) {
        const stat = fs.statSync(servePath);
        const mimeType = 'video/mp4';
        const fileSize = stat.size;
        const range = request.headers.range;

        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunksize = end - start + 1;

          reply.status(206);
          reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
          reply.header('Accept-Ranges', 'bytes');
          reply.header('Content-Length', chunksize);
          reply.header('Content-Type', mimeType);
          return sendThrottled(request, reply, fs.createReadStream(servePath, { start, end }));
        } else {
          reply.header('Accept-Ranges', 'bytes');
          reply.header('Content-Length', fileSize);
          reply.header('Content-Type', mimeType);
          return sendThrottled(request, reply, fs.createReadStream(servePath));
        }
      }
    }

    // --- Fallback: serve original file ---
    const range = request.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : Number(file.size_bytes) - 1;
      const chunksize = (end - start) + 1;
      
      reply.status(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${file.size_bytes}`);
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Content-Length', chunksize);
      reply.header('Content-Type', file.mime_type);
      return sendThrottled(request, reply, fs.createReadStream(fullPath, { start, end }));
    } else {
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Content-Length', file.size_bytes);
      reply.header('Content-Type', file.mime_type);
      return sendThrottled(request, reply, fs.createReadStream(fullPath));
    }
  });

  fastify.get<{ Params: { id: string }, Querystring: { shareToken?: string } }>('/api/media/:id/queue-status', async (request, reply) => {
    const { id } = request.params;
    if (!(await verifyMediaAccess(request, reply, id))) return;

    // Fast DB check first
    const res = await query(`SELECT is_transcoded FROM media_files WHERE id = $1`, [id]);
    if (res.rows.length === 0) return reply.status(404).send({ error: 'File not found' });
    if (res.rows[0].is_transcoded) return reply.send({ status: 'completed' });

    const { videoQueue } = await import('../../queue/videoQueue');
    
    // Check active jobs
    const activeJobs = await videoQueue.getActive();
    const isActive = activeJobs.some(j => j.data?.mediaId === id);
    if (isActive) {
      return reply.send({ status: 'processing', position: 0 });
    }

    // Check waiting jobs
    const waitingJobs = await videoQueue.getWaiting();
    const waitingIndex = waitingJobs.findIndex(j => j.data?.mediaId === id);
    if (waitingIndex !== -1) {
      return reply.send({ status: 'queued', position: waitingIndex + 1 });
    }

    return reply.send({ status: 'unknown' });
  });

  fastify.post<{ Params: { id: string }, Querystring: { shareToken?: string } }>('/api/media/:id/repair', async (request, reply) => {
    const { id } = request.params;
    if (!(await verifyMediaAccess(request, reply, id))) return;

    const result = await query(`
      SELECT folder_path, file_name, mime_type, is_transcoded, transcoded_mp4_path, transcoded_webm_path 
      FROM media_files WHERE id = $1`, 
    [id]);
    
    if (result.rows.length === 0) return reply.status(404).send({ error: 'File not found' });
    const file = result.rows[0];

    if (!file.is_transcoded || !file.transcoded_mp4_path) {
      return reply.send({ message: 'Already processing or not transcoded' });
    }

    try {
      // Check if ffprobe can read the moov atom and valid headers
      await execFileAsync('ffprobe', [file.transcoded_mp4_path]);
      return reply.send({ message: 'File is valid, no repair needed' });
    } catch (err: any) {
      console.warn(`Repair endpoint detected corrupted video for ${file.file_name}: ${err.message}`);
      
      // Reset database flags
      await query(`UPDATE media_files SET has_480p = false, is_transcoded = false WHERE id = $1`, [id]);
      
      // Delete corrupted files
      if (file.transcoded_mp4_path) CacheTrackerService.unlinkFileSync(file.transcoded_mp4_path);
      if (file.transcoded_webm_path) CacheTrackerService.unlinkFileSync(file.transcoded_webm_path);
      
      // Re-queue
      const { videoQueue } = await import('../../queue/videoQueue');
      const fullPath = resolveMediaFullPath(file.folder_path, file.file_name);
      
      await videoQueue.add('process-video', { mediaId: id, fullPath, mimeType: file.mime_type, skipCascade: true }, { priority: 1 }).catch(() => {});
      
      return reply.send({ message: 'Repair initiated' });
    }
  });

  fastify.get<{ Params: { id: string }, Querystring: { shareToken?: string } }>('/api/media/:id/exif', async (request, reply) => {
    const { id } = request.params;
    if (!(await verifyMediaAccess(request, reply, id))) return;

    const result = await query(
      `SELECT folder_path, file_name, mime_type FROM media_files WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) return reply.status(404).send({ error: 'File not found' });

    const file = result.rows[0];
    const fullPath = resolveMediaFullPath(file.folder_path, file.file_name);
    if (!fs.existsSync(fullPath)) return reply.status(404).send({ error: 'Source file missing' });

    try {
      const exifrModule = await import('exifr'); const exifr = exifrModule.default || exifrModule;
      const fileBuf = await fs.promises.readFile(fullPath);
      const rawData = await exifr.parse(fileBuf, {
        tiff: true,
        exif: true,
        translateKeys: true,
        translateValues: true,
        reviveValues: true
      });
      return reply.send(rawData || {});
    } catch (e: any) {
      return reply.status(500).send({ error: 'Failed to parse EXIF', details: e.message });
    }
  });

  fastify.post<{ Params: { id: string }, Body: { is_favorite?: boolean } }>('/api/media/:id/favorite', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    const { is_favorite } = (request.body || {}) as { is_favorite?: boolean };
    const mediaRes = await query(`SELECT id, folder_path, is_favorite FROM media_files WHERE id = $1`, [id]);
    if (mediaRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Media file not found' });
    }
    const media = mediaRes.rows[0];
    if (media.folder_path && !hasFolderAccess(request.user!, media.folder_path)) {
      return reply.status(403).send({ error: 'Forbidden: You do not have access to this folder' });
    }
    const currentFav = media.is_favorite ?? false;
    const nextFav = typeof is_favorite === 'boolean' ? is_favorite : !currentFav;
    await query(`UPDATE media_files SET is_favorite = $1, updated_at = NOW() WHERE id = $2`, [nextFav, id]);
    return reply.send({ success: true, id, is_favorite: nextFav });
  });

}
