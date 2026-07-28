import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { query } from '../../config/db';
import { requireAuth, verifyMediaAccess } from '../../utils/auth';
import { SmartSearchService } from './smartSearch.service';

const defaultCacheDir = fs.existsSync('/app/cache') ? '/app/cache' : path.resolve(process.cwd(), '../volumes/cache_rw');
const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || defaultCacheDir);
const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro'));
const FACE_THUMB_SIZE = 300;
const FACE_PADDING = 0.5;

function parseBoundingBox(box: any): { left: number; top: number; width: number; height: number } {
  if (box && box.x1 !== undefined && box.y1 !== undefined && box.x2 !== undefined && box.y2 !== undefined) {
    const w = box.x2 - box.x1;
    const h = box.y2 - box.y1;
    const padW = w * FACE_PADDING;
    const padH = h * FACE_PADDING;
    return {
      left: Math.max(0, Math.floor(box.x1 - padW)),
      top: Math.max(0, Math.floor(box.y1 - padH)),
      width: Math.ceil(w + padW * 2),
      height: Math.ceil(h + padH * 2),
    };
  }
  if (box && box.x !== undefined && box.y !== undefined && box.w !== undefined && box.h !== undefined) {
    const padW = box.w * FACE_PADDING;
    const padH = box.h * FACE_PADDING;
    return {
      left: Math.max(0, Math.floor(box.x - padW)),
      top: Math.max(0, Math.floor(box.y - padH)),
      width: Math.ceil(box.w + padW * 2),
      height: Math.ceil(box.h + padH * 2),
    };
  }
  return { left: 0, top: 0, width: 100, height: 100 };
}

export async function mlRoutes(fastify: FastifyInstance) {
  
  // Get all unique people clusters (with a representative face image and face count)
  fastify.get('/api/faces', { preHandler: requireAuth }, async (request, reply) => {
    const result = await query(`
      WITH person_clusters AS (
        SELECT 
          person_id,
          COUNT(*)::int as face_count,
          MAX(created_at) as latest_created
        FROM face_embeddings
        WHERE person_id IS NOT NULL
        GROUP BY person_id
      ),
      rep_faces AS (
        SELECT DISTINCT ON (person_id)
          person_id,
          media_id,
          bounding_box
        FROM face_embeddings
        WHERE person_id IS NOT NULL
        ORDER BY person_id, created_at DESC
      )
      SELECT 
        pc.person_id as id,
        pc.person_id,
        pc.face_count as count,
        pc.face_count,
        rf.media_id,
        rf.bounding_box,
        m.blurhash,
        m.file_name,
        m.folder_path,
        p.name,
        p.cover_media_id
      FROM person_clusters pc
      JOIN rep_faces rf ON pc.person_id = rf.person_id
      JOIN media_files m ON m.id = rf.media_id
      LEFT JOIN people p ON p.id = pc.person_id
      ORDER BY pc.face_count DESC, pc.latest_created DESC
    `);
    
    return reply.send(result.rows);
  });

  // Update a person's name
  fastify.post<{ Params: { id: string } }>('/api/faces/:id/name', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    const { name } = (request.body || {}) as { name: string };
    
    if (!name) {
      return reply.status(400).send({ error: 'Name is required' });
    }

    await query(`
      INSERT INTO people (id, name)
      VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
    `, [id, name]);

    return reply.send({ success: true, name });
  });

  // Get person details
  fastify.get<{ Params: { id: string } }>('/api/faces/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    const result = await query(`SELECT id, name FROM people WHERE id = $1`, [id]);
    if (result.rows.length === 0) {
      return reply.send({ id, name: '' });
    }
    return reply.send(result.rows[0]);
  });

  // Get all media files associated with a specific person
  fastify.get<{ Params: { id: string } }>('/api/faces/:id/media', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    
    const result = await query(`
      SELECT m.*, f.bounding_box, fs.cover_media_id AS folder_cover_id
      FROM media_files m
      JOIN face_embeddings f ON m.id = f.media_id
      LEFT JOIN folder_settings fs ON fs.folder_path = m.folder_path
      WHERE f.person_id = $1
      ORDER BY m.created_at DESC
    `, [id]);
    return reply.send(result.rows);
  });

  // Set or get the cover image for a person
  fastify.get<{ Params: { id: string } }>('/api/faces/:id/cover', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;

    // Check if person has an explicitly set cover
    const explicit = await query(`SELECT cover_media_id FROM people WHERE id = $1 AND cover_media_id IS NOT NULL`, [id]);
    if (explicit.rows.length > 0 && explicit.rows[0].cover_media_id) {
      const mediaResult = await query(`
        SELECT m.id, (
          SELECT bounding_box FROM face_embeddings
          WHERE media_id = m.id AND person_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        ) AS bounding_box,
        (m.exif_json->>'width')::int AS img_width,
        (m.exif_json->>'height')::int AS img_height
        FROM media_files m WHERE m.id = $2
      `, [id, explicit.rows[0].cover_media_id]);
      if (mediaResult.rows.length > 0) {
        const row = mediaResult.rows[0];
        return reply.send({ mediaId: row.id, boundingBox: row.bounding_box, imgWidth: row.img_width, imgHeight: row.img_height });
      }
    }

    // Fall back to dynamic selection (photo with fewest other faces)
    const result = await query(`
      SELECT m.id, (
        SELECT bounding_box FROM face_embeddings
        WHERE media_id = m.id AND person_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      ) AS bounding_box,
      (m.exif_json->>'width')::int AS img_width,
      (m.exif_json->>'height')::int AS img_height
      FROM media_files m
      WHERE EXISTS (
        SELECT 1 FROM face_embeddings
        WHERE media_id = m.id AND person_id = $1
      )
      ORDER BY (
        SELECT COUNT(*) FROM face_embeddings WHERE media_id = m.id
      ) ASC, m.created_at DESC
      LIMIT 1
    `, [id]);

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'No media found for this person' });
    }
    const row = result.rows[0];
    return reply.send({ mediaId: row.id, boundingBox: row.bounding_box, imgWidth: row.img_width, imgHeight: row.img_height });
  });

  // Explicitly set the cover image for a person
  fastify.post<{ Params: { id: string }, Body: { mediaId: string } }>('/api/faces/:id/cover', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    const { mediaId } = request.body;

    await query(`
      INSERT INTO people (id, name, cover_media_id)
      VALUES ($1, '', $2)
      ON CONFLICT (id) DO UPDATE SET cover_media_id = EXCLUDED.cover_media_id
    `, [id, mediaId]);

    // Delete cached face thumbnail so it regenerates from the new cover photo
    const cachedPath = path.join(CACHE_ROOT, 'faces', `${id}.webp`);
    if (fs.existsSync(cachedPath)) {
      await fs.promises.unlink(cachedPath);
    }

    return reply.send({ success: true, mediaId });
  });

  // Serve or generate a face thumbnail for a person
  fastify.get<{ Params: { id: string } }>('/api/faces/:id/thumbnail', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    const facesDir = path.join(CACHE_ROOT, 'faces');
    await fs.promises.mkdir(facesDir, { recursive: true });
    const cachedPath = path.join(facesDir, `${id}.webp`);

    if (fs.existsSync(cachedPath)) {
      const mtime = fs.statSync(cachedPath).mtimeMs;
      const etag = `"${id}-${Math.floor(mtime)}"`;
      reply.header('ETag', etag);
      if (request.headers['if-none-match'] === etag) {
        return reply.status(304).send();
      }
      reply.header('Content-Type', 'image/webp');
      reply.header('Cache-Control', 'no-cache, must-revalidate');
      return reply.send(fs.createReadStream(cachedPath));
    }

    // Check for explicitly set cover first, then fall back to best solo photo
    const coverResult = await query(`SELECT cover_media_id FROM people WHERE id = $1 AND cover_media_id IS NOT NULL`, [id]);
    if (coverResult.rows.length > 0 && coverResult.rows[0].cover_media_id) {
      const mediaResult = await query(`
        SELECT fe.media_id, fe.bounding_box, m.folder_path, m.file_name
        FROM face_embeddings fe
        JOIN media_files m ON m.id = fe.media_id
        WHERE fe.person_id = $1 AND fe.media_id = $2
        ORDER BY fe.created_at DESC
        LIMIT 1
      `, [id, coverResult.rows[0].cover_media_id]);
      if (mediaResult.rows.length > 0) {
        const face = mediaResult.rows[0];
        const fullPath = path.join(MEDIA_ROOT, face.folder_path, face.file_name);
        if (fs.existsSync(fullPath)) {
          try {
            const crop = parseBoundingBox(face.bounding_box);
            const meta = await sharp(fullPath).metadata();
            const imgW = meta.width || 1;
            const imgH = meta.height || 1;
            crop.left = Math.min(crop.left, imgW - 1);
            crop.top = Math.min(crop.top, imgH - 1);
            crop.width = Math.min(crop.width, imgW - crop.left);
            crop.height = Math.min(crop.height, imgH - crop.top);
            await sharp(fullPath)
              .extract(crop)
              .resize(FACE_THUMB_SIZE, FACE_THUMB_SIZE, { fit: 'cover', withoutEnlargement: true })
              .webp({ quality: 75 })
              .toFile(cachedPath);
            const mtime = fs.statSync(cachedPath).mtimeMs;
            reply.header('ETag', `"${id}-${Math.floor(mtime)}"`);
            reply.header('Content-Type', 'image/webp');
            reply.header('Cache-Control', 'no-cache, must-revalidate');
            return reply.send(fs.createReadStream(cachedPath));
          } catch (err: any) {
            console.error(`[Face Thumbnail] Failed to generate from cover for ${id}:`, err.message);
          }
        }
      }
    }

    // Fall back to best solo photo (fewest other faces)
    const repResult = await query(`
      SELECT fe.media_id, fe.bounding_box, m.folder_path, m.file_name
      FROM face_embeddings fe
      JOIN media_files m ON m.id = fe.media_id
      WHERE fe.person_id = $1
      ORDER BY (
        SELECT COUNT(*) FROM face_embeddings WHERE media_id = fe.media_id
      ) ASC, m.created_at DESC
      LIMIT 1
    `, [id]);

    if (repResult.rows.length === 0) {
      return reply.status(404).send({ error: 'No face found for this person' });
    }

    const face = repResult.rows[0];
    const fullPath = path.join(MEDIA_ROOT, face.folder_path, face.file_name);

    if (!fs.existsSync(fullPath)) {
      return reply.status(404).send({ error: 'Source image not found' });
    }

    try {
      const crop = parseBoundingBox(face.bounding_box);
      const meta = await sharp(fullPath).metadata();
      const imgW = meta.width || 1;
      const imgH = meta.height || 1;
      crop.left = Math.min(crop.left, imgW - 1);
      crop.top = Math.min(crop.top, imgH - 1);
      crop.width = Math.min(crop.width, imgW - crop.left);
      crop.height = Math.min(crop.height, imgH - crop.top);

      await sharp(fullPath)
        .extract(crop)
        .resize(FACE_THUMB_SIZE, FACE_THUMB_SIZE, { fit: 'cover', withoutEnlargement: true })
        .webp({ quality: 75 })
        .toFile(cachedPath);

      const mtime = fs.statSync(cachedPath).mtimeMs;
      reply.header('ETag', `"${id}-${Math.floor(mtime)}"`);
      reply.header('Content-Type', 'image/webp');
      reply.header('Cache-Control', 'no-cache, must-revalidate');
      return reply.send(fs.createReadStream(cachedPath));
    } catch (err: any) {
      console.error(`[Face Thumbnail] Failed to generate for ${id}:`, err.message);
      return reply.status(500).send({ error: 'Failed to generate face thumbnail' });
    }
  });

  // Get all faces in a specific media file
  fastify.get<{ Params: { id: string }, Querystring: { shareToken?: string } }>('/api/media/:id/faces', async (request, reply) => {
    const { id } = request.params;
    
    if (!(await verifyMediaAccess(request, reply, id))) return;

    const result = await query(`
      SELECT DISTINCT ON (fe.person_id) fe.person_id, fe.bounding_box, p.name
      FROM face_embeddings fe
      LEFT JOIN people p ON p.id = fe.person_id
      WHERE fe.media_id = $1
    `, [id]);
    
    return reply.send(result.rows);
  });

  // Smart Search Endpoint GET /api/media/search?q=...
  fastify.get('/api/media/search', { preHandler: requireAuth }, async (request, reply) => {
    const { q, query: searchQuery, limit } = request.query as { q?: string; query?: string; limit?: string };
    const searchText = q || searchQuery;
    const maxResults = limit ? parseInt(limit, 10) : 20;

    if (!searchText) {
      return reply.send([]);
    }

    const results = await SmartSearchService.searchMedia(searchText, maxResults);
    return reply.send(results);
  });

  // Smart Search Endpoint POST /api/search
  fastify.post('/api/search', { preHandler: requireAuth }, async (request, reply) => {
    const { q, query: searchQuery, limit } = (request.body || {}) as { q?: string; query?: string; limit?: number };
    const searchText = q || searchQuery;
    const maxResults = limit || 20;

    if (!searchText) {
      return reply.send([]);
    }

    const results = await SmartSearchService.searchMedia(searchText, maxResults);
    return reply.send(results);
  });

  // Vector smart search endpoint GET /api/search/smart
  fastify.get('/api/search/smart', { preHandler: requireAuth }, async (request, reply) => {
    const { mediaId, q, query: searchQuery, limit } = request.query as { mediaId?: string; q?: string; query?: string; limit?: string };
    const maxResults = limit ? parseInt(limit, 10) : 20;
    const searchText = q || searchQuery;

    if (searchText) {
      const results = await SmartSearchService.searchMedia(searchText, maxResults);
      return reply.send(results);
    }

    if (!mediaId) {
      const res = await query(`
        SELECT m.id as media_id, m.id, m.file_name, m.folder_path, m.created_at
        FROM media_files m
        WHERE m.clip_embedding IS NOT NULL
        LIMIT $1
      `, [maxResults]);
      return reply.send(res.rows);
    }

    // Similarity search for a given mediaId
    const mediaRes = await query(`SELECT clip_embedding::text FROM media_files WHERE id = $1`, [mediaId]);
    let vectorStr = mediaRes.rows.length > 0 ? mediaRes.rows[0].clip_embedding : null;

    if (!vectorStr) {
      // Fallback check smart_search_embeddings table
      const embedRes = await query(`SELECT embedding::text FROM smart_search_embeddings WHERE media_id = $1`, [mediaId]);
      if (embedRes.rows.length > 0) {
        vectorStr = embedRes.rows[0].embedding;
      }
    }

    if (!vectorStr) {
      return reply.send([]);
    }

    const result = await query(`
      SELECT m.id as media_id, m.id, m.file_name, m.folder_path, (m.clip_embedding <=> $1::vector) as distance
      FROM media_files m
      WHERE m.clip_embedding IS NOT NULL
      ORDER BY m.clip_embedding <=> $1::vector ASC
      LIMIT $2
    `, [vectorStr, maxResults]);

    return reply.send(result.rows);
  });
}
