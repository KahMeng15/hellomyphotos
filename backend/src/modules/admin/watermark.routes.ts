import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { requireAuth } from '../../utils/auth';
import { query } from '../../config/db';
import { WatermarkService, WatermarkTemplate } from '../media/watermark.service';

const defaultCacheDir = fs.existsSync('/app/cache') ? '/app/cache' : path.resolve(process.cwd(), '../volumes/cache_rw');
const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || defaultCacheDir);
const WATERMARK_DIR = path.join(CACHE_ROOT, 'watermarks');
if (!fs.existsSync(WATERMARK_DIR)) {
  fs.mkdirSync(WATERMARK_DIR, { recursive: true });
}

export async function watermarkRoutes(fastify: FastifyInstance) {
  // Middleware to ensure user is admin
  const requireAdmin = async (request: any, reply: any) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    const role = request.user?.role;
    if (role !== 'admin' && role !== 'super_admin') {
      return reply.status(403).send({ error: 'Forbidden: Admin access required' });
    }
  };

  /**
   * List all watermark templates
   */
  fastify.get('/api/admin/watermark/templates', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const templates = await WatermarkService.getAllTemplates();
      const { enforceGlobal, globalTemplateId } = await WatermarkService.getGlobalEnforcement();
      return reply.send({ templates, enforceGlobal, globalTemplateId });
    } catch (e: any) {
      request.log.error(e);
      return reply.status(500).send({ error: e.message });
    }
  });

  /**
   * Create a new watermark template
   */
  fastify.post('/api/admin/watermark/templates', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const data = request.body as Partial<WatermarkTemplate>;
      if (!data.name) {
        return reply.status(400).send({ error: 'Template name is required' });
      }
      const created = await WatermarkService.createTemplate(data);
      return reply.status(201).send(created);
    } catch (e: any) {
      request.log.error(e);
      return reply.status(500).send({ error: e.message });
    }
  });

  /**
   * Get single watermark template
   */
  fastify.get<{ Params: { id: string } }>('/api/admin/watermark/templates/:id', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const template = await WatermarkService.getTemplate(request.params.id);
      if (!template) {
        return reply.status(404).send({ error: 'Template not found' });
      }
      return reply.send(template);
    } catch (e: any) {
      request.log.error(e);
      return reply.status(500).send({ error: e.message });
    }
  });

  /**
   * Update an existing watermark template
   */
  fastify.put<{ Params: { id: string } }>('/api/admin/watermark/templates/:id', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const data = request.body as Partial<WatermarkTemplate>;
      const updated = await WatermarkService.updateTemplate(request.params.id, data);
      return reply.send(updated);
    } catch (e: any) {
      request.log.error(e);
      return reply.status(500).send({ error: e.message });
    }
  });

  /**
   * Explicitly regenerate watermarked photos for a template across active shares
   */
  fastify.post<{ Params: { id: string } }>('/api/admin/watermark/templates/:id/regenerate', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const result = await WatermarkService.regenerateTemplatePreviews(request.params.id);
      return reply.send(result);
    } catch (e: any) {
      request.log.error(e);
      return reply.status(500).send({ error: e.message });
    }
  });

  /**
   * Delete a watermark template
   */
  fastify.delete<{ Params: { id: string } }>('/api/admin/watermark/templates/:id', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const success = await WatermarkService.deleteTemplate(request.params.id);
      return reply.send({ success });
    } catch (e: any) {
      request.log.error(e);
      return reply.status(500).send({ error: e.message });
    }
  });

  /**
   * Upload logo graphic for image watermarks (Base64 JSON)
   */
  fastify.post('/api/admin/watermark/upload-logo', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { data, fileName } = (request.body || {}) as { data: string; fileName?: string };
      if (!data) {
        return reply.status(400).send({ error: 'Image base64 data required' });
      }

      // Extract format and payload from data URI (e.g. data:image/png;base64,iVBOR...)
      const matches = data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      let buffer: Buffer;
      let ext = '.png';

      if (matches && matches.length === 3) {
        const mime = matches[1];
        if (mime.includes('svg')) ext = '.svg';
        else if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg';
        else if (mime.includes('webp')) ext = '.webp';
        buffer = Buffer.from(matches[2], 'base64');
      } else {
        buffer = Buffer.from(data, 'base64');
      }

      const fileId = crypto.randomBytes(8).toString('hex');
      const safeName = `logo_${fileId}${ext}`;
      const destPath = path.join(WATERMARK_DIR, safeName);

      await fs.promises.writeFile(destPath, buffer);

      return reply.send({
        success: true,
        imagePath: `watermarks/${safeName}`,
        fileName: safeName
      });
    } catch (e: any) {
      request.log.error(e);
      return reply.status(500).send({ error: e.message });
    }
  });

  /**
   * Get sample images from library for live watermark studio preview
   */
  fastify.get('/api/admin/watermark/sample-images', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { rows } = await query(
        `SELECT id, file_name, folder_path, 
                COALESCE(img_width, (exif_json->>'width')::int, 1200) as img_width, 
                COALESCE(img_height, (exif_json->>'height')::int, 800) as img_height, 
                created_at, 
                exif_json->>'Make' as camera_make, 
                exif_json->>'Model' as camera_model, 
                exif_json->>'LensModel' as lens_model 
         FROM media_files 
         WHERE mime_type LIKE 'image/%' AND processing_error IS NULL
         ORDER BY created_at DESC 
         LIMIT 12`
      );
      return reply.send({ images: rows });
    } catch (e: any) {
      request.log.error(e);
      return reply.status(500).send({ error: e.message });
    }
  });

  /**
   * Generate dynamic live preview sample
   */
  fastify.post('/api/admin/watermark/preview', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { template, sampleType, mediaId } = (request.body || {}) as {
        template: Partial<WatermarkTemplate>;
        sampleType?: 'dark' | 'light' | 'portrait' | 'landscape';
        mediaId?: string;
      };

      const buffer = await WatermarkService.renderPreviewSample(template || {}, sampleType || 'landscape', mediaId);
      reply.header('Content-Type', 'image/webp');
      reply.header('Cache-Control', 'no-store');
      return reply.send(buffer);
    } catch (e: any) {
      request.log.error(e);
      return reply.status(500).send({ error: e.message });
    }
  });
}
