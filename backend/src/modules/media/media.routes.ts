import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import { query } from '../../config/db';
import { AnalyticsService } from '../analytics/analytics.service';
import { WatermarkService } from './watermark.service';

const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || path.resolve(process.cwd(), '../volumes/cache_rw'));
const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro'));

import { verifyMediaAccess } from '../../utils/auth';

import { getThrottleLimit, BandwidthThrottler } from '../../utils/throttle';
async function sendThrottled(request: FastifyRequest, reply: FastifyReply, stream: NodeJS.ReadableStream | Buffer) {
  const isAuth = (request as any).user != null;
  const limit = await getThrottleLimit(isAuth);
  if (limit > 0 && typeof (stream as any).pipe === 'function') {
    return reply.send((stream as any).pipe(new BandwidthThrottler(limit)));
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
      reply.header('Cache-Control', 'public, max-age=31536000');
      return sendThrottled(request, reply, fs.createReadStream(filePath));
    }
    
    // Fallback: serve original if processing isn't done (for images only)
    const result = await query(`SELECT folder_path, file_name, mime_type FROM media_files WHERE id = $1`, [id]);
    if (result.rows.length > 0) {
      const file = result.rows[0];
      const fullPath = path.join(MEDIA_ROOT, file.folder_path, file.file_name);
      if (fs.existsSync(fullPath) && file.mime_type.startsWith('image/')) {
        reply.header('Content-Type', file.mime_type);
        reply.header('Cache-Control', 'public, max-age=30'); // Short cache so they upgrade to webp later
        return sendThrottled(request, reply, fs.createReadStream(fullPath));
      }
    }

    return reply.status(404).send({ error: 'Thumbnail not found or still processing' });
  });

  fastify.get<{ Params: { id: string }, Querystring: { watermark?: string, shareToken?: string } }>('/api/media/:id/preview', async (request, reply) => {
    const { id } = request.params;
    
    if (!(await verifyMediaAccess(request, reply, id))) return;

    const { watermark } = request.query;
    const filePath = path.join(CACHE_ROOT, '1080p', `${id}.webp`);
    
    // Log analytics
    AnalyticsService.logView(id, 'VIEW_1080P', 120000); // Rough byte size estimate for analytics buffer

    if (fs.existsSync(filePath)) {
      reply.header('Content-Type', 'image/webp');
      
      const wSettings = await WatermarkService.getSettings();
      if (watermark === 'true' || wSettings.enforceGlobal) {
        reply.header('Cache-Control', 'private, no-store');
        const buffer = await WatermarkService.addWatermarkToStream(filePath);
        return sendThrottled(request, reply, buffer);
      } else {
        reply.header('Cache-Control', 'public, max-age=31536000');
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

    const { download, watermark } = request.query as any;
    const result = await query(`SELECT folder_path, file_name, mime_type, size_bytes FROM media_files WHERE id = $1`, [id]);
    
    if (result.rows.length === 0) return reply.status(404).send({ error: 'File not found' });
    
    const file = result.rows[0];
    const fullPath = path.join(MEDIA_ROOT, file.folder_path, file.file_name);
    
    if (!fs.existsSync(fullPath)) return reply.status(404).send({ error: 'Source file missing' });

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
      reply.header('Content-Length', file.size_bytes);
      reply.header('Content-Type', file.mime_type);
      return sendThrottled(request, reply, fs.createReadStream(fullPath));
    }
  });
}
