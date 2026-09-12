import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import util from 'util';
import { execFile } from 'child_process';
const execFileAsync = util.promisify(execFile);
import { query } from '../../config/db';
import { AnalyticsService } from '../analytics/analytics.service';
import { WatermarkService } from './watermark.service';

const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || path.resolve(process.cwd(), '../volumes/cache_rw'));
const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro'));

import { verifyMediaAccess } from '../../utils/auth';
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
    
    if (!(await verifyMediaAccess(request, reply, id))) return;

    const filePath = path.join(CACHE_ROOT, '480p', `${id}.webp`);
    
    if (fs.existsSync(filePath)) {
      reply.header('Content-Type', 'image/webp');
      reply.header('Cache-Control', 'public, max-age=3600');
      return sendThrottled(request, reply, fs.createReadStream(filePath));
    }
    
    // Fallback: serve original if processing isn't done (for images only)
    const result = await query(`SELECT folder_path, file_name, mime_type FROM media_files WHERE id = $1`, [id]);
    if (result.rows.length > 0) {
      const file = result.rows[0];
      const fullPath = path.join(MEDIA_ROOT, file.folder_path, file.file_name);
      
      // Enqueue high-priority job for missing thumbnail
      if (file.mime_type.startsWith('video/')) {
        await videoQueue.add('process-video', { mediaId: id, fullPath, mimeType: file.mime_type }, { priority: 1 }).catch(() => {});
      } else if (file.mime_type.startsWith('image/')) {
        await thumbnailQueue.add('generate-thumbnail', { mediaId: id, fullPath, mimeType: file.mime_type }, { priority: 1 }).catch(() => {});
      }

      if (fs.existsSync(fullPath) && file.mime_type.startsWith('image/')) {
        reply.header('Content-Type', file.mime_type);
        reply.header('Cache-Control', 'public, max-age=30'); // Short cache so they upgrade to webp later
        return sendThrottled(request, reply, fs.createReadStream(fullPath));
      }

      // For videos still being processed: return 202 so browsers know to retry
      if (file.mime_type.startsWith('video/')) {
        reply.header('Cache-Control', 'no-cache');
        reply.header('Retry-After', '5');
        return reply.status(202).send({ message: 'Thumbnail is being generated, please retry shortly' });
      }
    }

    return reply.status(404).send({ error: 'Thumbnail not found' });
  });

  fastify.get<{ Params: { id: string }, Querystring: { watermark?: string, shareToken?: string, context?: string } }>('/api/media/:id/preview', async (request, reply) => {
    const { id } = request.params;
    
    if (!(await verifyMediaAccess(request, reply, id))) return;

    const { watermark, shareToken, context } = request.query;
    const filePath = path.join(CACHE_ROOT, '1080p', `${id}.webp`);
    
    if (context === 'lightbox') {
      AnalyticsService.logView(id, 'VIEW_1080P', 120000, shareToken);
      AnalyticsService.logVisit({
        mediaId: id,
        shareToken,
        actionType: 'preview',
        ip: getClientIp(request),
        userAgent: request.headers['user-agent'] as string | undefined,
        referrer: request.headers.referer as string | undefined,
        path: request.url
      });
    }

    if (fs.existsSync(filePath)) {
      reply.header('Content-Type', 'image/webp');
      
      const wSettings = await WatermarkService.getSettings();
      if (watermark === 'true' || wSettings.enforceGlobal) {
        reply.header('Cache-Control', 'private, no-store');
        const buffer = await WatermarkService.addWatermarkToStream(filePath);
        return sendThrottled(request, reply, buffer);
      } else {
        reply.header('Cache-Control', 'public, max-age=3600');
        return sendThrottled(request, reply, fs.createReadStream(filePath));
      }
    }
    // Fallback to 480p if 1080p isn't ready or doesn't exist (e.g. video thumbs)
    const fallback = path.join(CACHE_ROOT, '480p', `${id}.webp`);
    if (fs.existsSync(fallback)) {
      reply.header('Content-Type', 'image/webp');
      return sendThrottled(request, reply, fs.createReadStream(fallback));
    }
    
    // Fallback to original image
    const result = await query(`SELECT folder_path, file_name, mime_type FROM media_files WHERE id = $1`, [id]);
    if (result.rows.length > 0) {
      const file = result.rows[0];
      const fullPath = path.join(MEDIA_ROOT, file.folder_path, file.file_name);
      
      // Enqueue high-priority job for missing preview
      if (file.mime_type.startsWith('video/')) {
        await videoQueue.add('process-video', { mediaId: id, fullPath, mimeType: file.mime_type }, { priority: 1 }).catch(() => {});
      } else if (file.mime_type.startsWith('image/')) {
        await thumbnailQueue.add('generate-thumbnail', { mediaId: id, fullPath, mimeType: file.mime_type }, { priority: 1 }).catch(() => {});
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
              is_transcoded, transcoded_mp4_path, transcoded_webm_path
       FROM media_files WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) return reply.status(404).send({ error: 'File not found' });
    
    const file = result.rows[0];
    const fullPath = path.join(MEDIA_ROOT, file.folder_path, file.file_name);
    
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

    const wSettings = await WatermarkService.getSettings();
    if (download !== 'true' && download !== '1' && (watermark === 'true' || wSettings.enforceGlobal)) {
      reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(file.file_name)}"`);
      reply.header('Cache-Control', 'private, no-store');
      const buffer = await WatermarkService.addWatermarkToStream(fullPath);
      return sendThrottled(request, reply, buffer);
    }

    if (download === '1' || download === 'true') {
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.file_name)}"`);
    } else {
      reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(file.file_name)}"`);
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
      try { fs.unlinkSync(file.transcoded_mp4_path); } catch (e) {}
      if (file.transcoded_webm_path) {
        try { fs.unlinkSync(file.transcoded_webm_path); } catch (e) {}
      }
      
      // Re-queue
      const { videoQueue } = await import('../../queue/videoQueue');
      const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || '/app/media');
      const fullPath = path.join(MEDIA_ROOT, file.folder_path, file.file_name);
      
      await videoQueue.add('process-video', { mediaId: id, fullPath, mimeType: file.mime_type, skipCascade: true }, { priority: 1 }).catch(() => {});
      
      return reply.send({ message: 'Repair initiated' });
    }
  });
}
