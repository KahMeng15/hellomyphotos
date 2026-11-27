import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { query } from '../../config/db';
import { redis, deleteKeysByPattern } from '../../config/redis';
import { requireAuth, verifyMediaAccess } from '../../utils/auth';
import { SmartSearchService } from './smartSearch.service';
import { MLService, FACE_THUMB_SIZE, FACE_PADDING, parseBoundingBox } from './ml.service';
import { faceThumbnailQueue } from '../../queue/faceThumbnailQueue';
import { CacheTrackerService } from '../media/cacheTracker.service';
import { PERSON_COVER_ORDER_CLAUSE } from './personCover.utils';

const defaultCacheDir = fs.existsSync('/app/cache') ? '/app/cache' : path.resolve(process.cwd(), '../volumes/cache_rw');
const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || defaultCacheDir);
const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro'));

class Semaphore {
  private tasks: (() => void)[] = [];
  constructor(private count: number) {}
  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.tasks.push(resolve);
    });
  }
  release(): void {
    if (this.tasks.length > 0) {
      const next = this.tasks.shift();
      if (next) next();
    } else {
      this.count++;
    }
  }
}
// Limit concurrent on-the-fly sharp extractions to avoid OOM
const faceThumbSemaphore = new Semaphore(4);

const currentlyGeneratingFaceThumbs = new Set<string>();

async function generateFaceThumbnailAsync(personId: string, face: any, fullPath: string, cachedPath: string) {
  const resolvedCache = path.resolve(cachedPath);
  const allowedFaces = path.resolve(CACHE_ROOT, 'faces');
  if (!resolvedCache.startsWith(allowedFaces + path.sep)) return;

  if (currentlyGeneratingFaceThumbs.has(personId)) return;
  currentlyGeneratingFaceThumbs.add(personId);
  try {
    await faceThumbSemaphore.acquire();
    if (fs.existsSync(resolvedCache)) return;
    
    await MLService.cropAndSaveFaceThumbnail(face, fullPath, resolvedCache);
  } catch (err: any) {
    console.error('[Face Thumbnail Async] Failed for %s:', personId, err.message);
  } finally {
    currentlyGeneratingFaceThumbs.delete(personId);
    faceThumbSemaphore.release();
  }
}

function sendDefaultAvatar(reply: any) {
  reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  reply.header('Content-Type', 'image/svg+xml');
  return reply.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><rect width="300" height="300" fill="#f0f0f0"/><circle cx="150" cy="120" r="60" fill="#bdbdbd"/><path d="M50 300 Q 150 180 250 300" fill="#bdbdbd"/></svg>`);
}

export async function mlRoutes(fastify: FastifyInstance) {
  
  // Get all unique people clusters (with a representative face image and face count)
  fastify.get<{ Querystring: { page?: string, limit?: string, sort?: string, refresh?: string } }>('/api/faces', { preHandler: requireAuth }, async (request, reply) => {
    const page = parseInt(request.query.page || '1', 10);
    const limit = parseInt(request.query.limit || '50', 10);
    const offset = (page - 1) * limit;
    const sort = request.query.sort || 'named';
    const refresh = request.query.refresh === '1';

    const cacheKey = `faces:list:${page}:${limit}:${sort}`;
    if (!refresh) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return reply.send(JSON.parse(cached));
      } catch {}
    }

    let orderByClause = 'ORDER BY p.face_count DESC, p.updated_at DESC';
    let outerOrderByClause = 'ORDER BY pp.face_count DESC, pp.updated_at DESC';
    if (sort === 'named') {
      orderByClause = "ORDER BY NULLIF(p.name, '') IS NULL ASC, p.face_count DESC, p.updated_at DESC";
      outerOrderByClause = "ORDER BY NULLIF(pp.name, '') IS NULL ASC, pp.face_count DESC, pp.updated_at DESC";
    } else if (sort === 'a-z') {
      orderByClause = "ORDER BY NULLIF(p.name, '') IS NULL ASC, p.name ASC, p.face_count DESC";
      outerOrderByClause = "ORDER BY NULLIF(pp.name, '') IS NULL ASC, pp.name ASC, pp.face_count DESC";
    } else if (sort === 'z-a') {
      orderByClause = "ORDER BY NULLIF(p.name, '') IS NULL ASC, p.name DESC, p.face_count DESC";
      outerOrderByClause = "ORDER BY NULLIF(pp.name, '') IS NULL ASC, pp.name DESC, pp.face_count DESC";
    }

    const result = await query(`
      WITH page_people AS (
        SELECT 
          p.id,
          p.name,
          p.face_count,
          p.cover_media_id,
          p.cover_face_id,
          p.updated_at
        FROM people p
        WHERE p.face_count > 0
        ${orderByClause}
        LIMIT $1 OFFSET $2
      ),
      rep_faces AS (
        SELECT 
          pp.id AS person_id,
          COALESCE(fe_cov.media_id, fb.media_id) AS media_id,
          COALESCE(fe_cov.bounding_box, fb.bounding_box) AS bounding_box
        FROM page_people pp
        LEFT JOIN face_embeddings fe_cov ON fe_cov.id = pp.cover_face_id
        LEFT JOIN LATERAL (
          SELECT fe.media_id, fe.bounding_box
          FROM face_embeddings fe
          JOIN media_files m ON m.id = fe.media_id
          WHERE fe.person_id = pp.id AND fe_cov.id IS NULL
            AND m.mime_type LIKE 'image/%'
          ORDER BY ${PERSON_COVER_ORDER_CLAUSE}
          LIMIT 1
        ) fb ON fe_cov.id IS NULL
      )
      SELECT 
        pp.id,
        pp.id AS person_id,
        pp.face_count AS count,
        pp.face_count,
        rf.media_id,
        rf.bounding_box,
        COALESCE(m.img_width, (m.exif_json->>'width')::int) AS img_width,
        COALESCE(m.img_height, (m.exif_json->>'height')::int) AS img_height,
        m.blurhash,
        m.file_name,
        m.folder_path,
        pp.name,
        pp.cover_media_id
      FROM page_people pp
      JOIN rep_faces rf ON pp.id = rf.person_id
      JOIN media_files m ON m.id = rf.media_id
      ${outerOrderByClause}
    `, [limit, offset]);
    
    const facesDir = path.join(CACHE_ROOT, 'faces');
    for (const row of result.rows) {
      const cachedPath = path.join(facesDir, `${row.person_id}.webp`);
      row.has_thumbnail = fs.existsSync(cachedPath);
      if (!row.has_thumbnail && row.media_id) {
        faceThumbnailQueue.add('generate-face-thumbnails', { mediaId: row.media_id }).catch((err: any) => console.error(err));
      }
    }

    try {
      await redis.set(cacheKey, JSON.stringify(result.rows), 'EX', 600);
    } catch {}

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
      INSERT INTO people (id, name, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
    `, [id, name]);

    try {
      await deleteKeysByPattern('faces:list:*');
    } catch {}

    return reply.send({ success: true, name });
  });

  // Merge person/faces
  fastify.post('/api/faces/merge', { preHandler: requireAuth }, async (request, reply) => {
    const body = (request.body || {}) as any;
    const targetPersonId = body.targetPersonId;
    const sourcePersonIds = Array.isArray(body.sourcePersonIds) 
      ? body.sourcePersonIds 
      : (body.sourcePersonId ? [body.sourcePersonId] : []);
    const preferredName = body.preferredName;

    if (!targetPersonId || !sourcePersonIds.length) {
      return reply.status(400).send({ error: 'Missing target or source person IDs' });
    }

    try {
      // 1. Move face embeddings
      await query(
        `UPDATE face_embeddings SET person_id = $1 WHERE person_id = ANY($2)`,
        [targetPersonId, sourcePersonIds]
      );

      // 2. Move shared folders
      await query(
        `UPDATE shared_folders SET person_id = $1 WHERE person_id = ANY($2)`,
        [targetPersonId, sourcePersonIds]
      );

      // 3. Update target name if specified, or if target is unnamed and a source was named
      let finalName = '';
      if (preferredName && typeof preferredName === 'string' && preferredName.trim()) {
        finalName = preferredName.trim();
        await query(`UPDATE people SET name = $1, updated_at = NOW() WHERE id = $2`, [finalName, targetPersonId]);
      } else {
        const targetRes = await query(`SELECT name FROM people WHERE id = $1`, [targetPersonId]);
        finalName = targetRes.rows[0]?.name || '';
        if (!finalName) {
          const sourceRes = await query(
            `SELECT name FROM people WHERE id = ANY($1) AND name IS NOT NULL AND name != '' LIMIT 1`,
            [sourcePersonIds]
          );
          if (sourceRes.rows.length > 0 && sourceRes.rows[0].name) {
            finalName = sourceRes.rows[0].name;
            await query(`UPDATE people SET name = $1, updated_at = NOW() WHERE id = $2`, [finalName, targetPersonId]);
          }
        }
      }

      // 4. Update face_count on target person
      await query(`
        UPDATE people 
        SET face_count = (SELECT COUNT(*)::int FROM face_embeddings WHERE person_id = $1),
            updated_at = NOW()
        WHERE id = $1
      `, [targetPersonId]);

      // 5. Delete source people
      await query(`DELETE FROM people WHERE id = ANY($1)`, [sourcePersonIds]);

      // 6. Delete cached face thumbnails for source persons
      const facesDir = path.resolve(CACHE_ROOT, 'faces');
      for (const sId of sourcePersonIds) {
        try {
          const safePersonId = path.basename(sId);
          const thumbPath = path.resolve(facesDir, `${safePersonId}.webp`);
          if (thumbPath.startsWith(facesDir) && fs.existsSync(thumbPath)) await fs.promises.unlink(thumbPath);
        } catch {}
      }

      // 7. Invalidate redis caches
      try {
        await deleteKeysByPattern('faces:list:*');
      } catch {}

      return reply.send({ success: true, targetPersonId, name: finalName, message: `Successfully merged faces into ${targetPersonId}` });
    } catch (e: any) {
      request.log.error(e);
      return reply.status(500).send({ error: e.message });
    }
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
  fastify.get<{ Params: { id: string }, Querystring: { q?: string } }>('/api/faces/:id/media', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    const { q } = (request.query || {}) as { q?: string };
    
    let result;
    if (q && q.trim().length > 0) {
      const escaped = q.trim().replace(/([%_\\])/g, '\\$1');
      result = await query(`
        SELECT m.*, f.bounding_box, COALESCE(fs.cover_media_id, fs.auto_cover_media_id) AS folder_cover_id
        FROM media_files m
        JOIN face_embeddings f ON m.id = f.media_id
        LEFT JOIN folder_settings fs ON fs.folder_path = m.folder_path
        WHERE f.person_id = $1 AND (m.file_name ILIKE $2 ESCAPE '\\' OR m.folder_path ILIKE $2 ESCAPE '\\')
        ORDER BY m.created_at DESC
      `, [id, `%${escaped}%`]);
    } else {
      result = await query(`
        SELECT m.*, f.bounding_box, COALESCE(fs.cover_media_id, fs.auto_cover_media_id) AS folder_cover_id
        FROM media_files m
        JOIN face_embeddings f ON m.id = f.media_id
        LEFT JOIN folder_settings fs ON fs.folder_path = m.folder_path
        WHERE f.person_id = $1
        ORDER BY m.created_at DESC
      `, [id]);
    }
    return reply.send(result.rows);
  });

  // Set or get the cover image for a person
  fastify.get<{ Params: { id: string } }>('/api/faces/:id/cover', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;

    let coverMediaId: string | null = null;
    let coverBoundingBox: any = null;
    let coverImgWidth: number | null = null;
    let coverImgHeight: number | null = null;
    let folderPath: string | null = null;
    let fileName: string | null = null;

    // Check if person has an explicitly set cover
    const explicit = await query(`SELECT cover_media_id FROM people WHERE id = $1 AND cover_media_id IS NOT NULL`, [id]);
    if (explicit.rows.length > 0 && explicit.rows[0].cover_media_id) {
      coverMediaId = explicit.rows[0].cover_media_id;
    }

    if (!coverMediaId) {
      // Fall back to dynamic selection: best solo/fewer faces, HD face, full face not cut off
      const result = await query(`
        SELECT fe.media_id, fe.bounding_box,
               COALESCE(m.img_width, (m.exif_json->>'width')::int) AS img_width,
               COALESCE(m.img_height, (m.exif_json->>'height')::int) AS img_height,
               m.folder_path, m.file_name
        FROM face_embeddings fe
        JOIN media_files m ON m.id = fe.media_id
        WHERE fe.person_id = $1
          AND m.mime_type LIKE 'image/%'
        ORDER BY ${PERSON_COVER_ORDER_CLAUSE}
        LIMIT 1
      `, [id]);

      if (result.rows.length === 0) {
        return reply.send({ coverMediaId: null, coverBoundingBox: null, originalWidth: null, originalHeight: null });
      }
      coverMediaId = result.rows[0].media_id;
      coverBoundingBox = result.rows[0].bounding_box;
      coverImgWidth = result.rows[0].img_width;
      coverImgHeight = result.rows[0].img_height;
      folderPath = result.rows[0].folder_path;
      fileName = result.rows[0].file_name;
    } else {
      // Fetch bounding box + dims for the explicit cover
      const mediaResult = await query(`
        SELECT fe.bounding_box,
               COALESCE(m.img_width, (m.exif_json->>'width')::int) AS img_width,
               COALESCE(m.img_height, (m.exif_json->>'height')::int) AS img_height,
               m.folder_path, m.file_name
        FROM face_embeddings fe
        JOIN media_files m ON m.id = fe.media_id
        WHERE fe.person_id = $1 AND fe.media_id = $2
        ORDER BY ${PERSON_COVER_ORDER_CLAUSE}
        LIMIT 1
      `, [id, coverMediaId]);

      if (mediaResult.rows.length === 0) {
        // Person might have cover_media_id with no face embedding, fetch from media_files directly
        const mfRes = await query(`
          SELECT COALESCE(img_width, (exif_json->>'width')::int) AS img_width,
                 COALESCE(img_height, (exif_json->>'height')::int) AS img_height,
                 folder_path, file_name
          FROM media_files WHERE id = $1
        `, [coverMediaId]);
        if (mfRes.rows.length === 0) {
          return reply.status(404).send({ error: 'No media found for this person' });
        }
        coverImgWidth = mfRes.rows[0].img_width;
        coverImgHeight = mfRes.rows[0].img_height;
        folderPath = mfRes.rows[0].folder_path;
        fileName = mfRes.rows[0].file_name;
      } else {
        coverBoundingBox = mediaResult.rows[0].bounding_box;
        coverImgWidth = mediaResult.rows[0].img_width;
        coverImgHeight = mediaResult.rows[0].img_height;
        folderPath = mediaResult.rows[0].folder_path;
        fileName = mediaResult.rows[0].file_name;
      }
    }

    // Fallback: read dimensions from file if EXIF is null
    if ((!coverImgWidth || !coverImgHeight) && folderPath && fileName) {
      try {
        const filePath = path.join(MEDIA_ROOT, folderPath || '', fileName);
        const meta = await sharp(filePath).metadata();
        if (meta.width) coverImgWidth = meta.width;
        if (meta.height) coverImgHeight = meta.height;
      } catch (e) {
        // non-critical
      }
    }

    return reply.send({ mediaId: coverMediaId, boundingBox: coverBoundingBox, imgWidth: coverImgWidth, imgHeight: coverImgHeight });
  });

  // Explicitly set the cover image for a person
  fastify.post<{ Params: { id: string }, Body: { mediaId: string } }>('/api/faces/:id/cover', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    const safeId = path.basename(id).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeId || safeId !== id) return reply.status(400).send({ error: 'Invalid ID' });
    const { mediaId } = request.body;

    await query(`
      INSERT INTO people (id, name, cover_media_id, cover_face_id, updated_at)
      VALUES (
        $1, 
        '', 
        $2, 
        (SELECT id FROM face_embeddings WHERE person_id = $1 AND media_id = $2 LIMIT 1),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET 
        cover_media_id = EXCLUDED.cover_media_id,
        cover_face_id = EXCLUDED.cover_face_id,
        updated_at = NOW()
    `, [safeId, mediaId]);

    try {
      await deleteKeysByPattern('faces:list:*');
    } catch {}

    // Delete cached face thumbnail so it regenerates from the new cover photo
    const facesDir = path.resolve(CACHE_ROOT, 'faces');
    const cachedPath = path.resolve(facesDir, `${safeId}.webp`);
    if (!cachedPath.startsWith(facesDir + path.sep)) {
      return reply.status(400).send({ error: 'Invalid ID' });
    }
    if (fs.existsSync(cachedPath)) {
      await CacheTrackerService.unlinkFile(cachedPath);
    }

    return reply.send({ success: true, mediaId });
  });

  // Serve or generate a face thumbnail for a person
  fastify.get<{ Params: { id: string }, Querystring: { refresh?: string } }>('/api/faces/:id/thumbnail', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    const safeId = path.basename(id).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeId || safeId !== id) return reply.status(400).send({ error: 'Invalid ID' });
    const facesDir = path.resolve(CACHE_ROOT, 'faces');
    await fs.promises.mkdir(facesDir, { recursive: true });
    const cachedPath = path.resolve(facesDir, `${safeId}.webp`);
    if (!cachedPath.startsWith(facesDir + path.sep)) {
      return reply.status(400).send({ error: 'Invalid ID' });
    }

    const refresh = request.query?.refresh === '1';
    if (!refresh && fs.existsSync(cachedPath)) {
      const mtime = fs.statSync(cachedPath).mtimeMs;
      const etag = `"${safeId}-${Math.floor(mtime)}"`;
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
    let faceToUse: any = null;
    let fullPathToUse: string | null = null;

    if (coverResult.rows.length > 0 && coverResult.rows[0].cover_media_id) {
      const mediaResult = await query(`
        SELECT fe.media_id, fe.bounding_box, m.folder_path, m.file_name,
               COALESCE(m.img_width, (m.exif_json->>'width')::int) AS img_width,
               COALESCE(m.img_height, (m.exif_json->>'height')::int) AS img_height
        FROM face_embeddings fe
        JOIN media_files m ON m.id = fe.media_id
        WHERE fe.person_id = $1 AND fe.media_id = $2
        ORDER BY ${PERSON_COVER_ORDER_CLAUSE}
        LIMIT 1
      `, [id, coverResult.rows[0].cover_media_id]);
      if (mediaResult.rows.length > 0) {
        const face = mediaResult.rows[0];
        const fullPath = path.join(MEDIA_ROOT, face.folder_path, face.file_name);
        const cache480 = path.join(CACHE_ROOT, '480p', `${face.media_id}.webp`);
        const cache1080 = path.join(CACHE_ROOT, '1080p', `${face.media_id}.webp`);
        if (fs.existsSync(fullPath) || fs.existsSync(cache480) || fs.existsSync(cache1080)) {
          faceToUse = face;
          fullPathToUse = fullPath; // `generateFaceThumbnailAsync` handles resolving the actual path
        }
      }
    }

    if (!faceToUse) {
      // Fall back to best solo photo, HD face, full face not cut off
      const repResult = await query(`
        SELECT fe.media_id, fe.bounding_box, m.folder_path, m.file_name,
               COALESCE(m.img_width, (m.exif_json->>'width')::int) AS img_width,
               COALESCE(m.img_height, (m.exif_json->>'height')::int) AS img_height
        FROM face_embeddings fe
        JOIN media_files m ON m.id = fe.media_id
        WHERE fe.person_id = $1
          AND m.mime_type LIKE 'image/%'
        ORDER BY ${PERSON_COVER_ORDER_CLAUSE}
        LIMIT 1
      `, [id]);

      if (repResult.rows.length > 0) {
        const face = repResult.rows[0];
        const fullPath = path.join(MEDIA_ROOT, face.folder_path, face.file_name);
        const cache480 = path.join(CACHE_ROOT, '480p', `${face.media_id}.webp`);
        const cache1080 = path.join(CACHE_ROOT, '1080p', `${face.media_id}.webp`);
        if (fs.existsSync(fullPath) || fs.existsSync(cache480) || fs.existsSync(cache1080)) {
          faceToUse = face;
          fullPathToUse = fullPath; // `generateFaceThumbnailAsync` handles resolving the actual path
        }
      }
    }

    if (!faceToUse || !fullPathToUse) {
      return sendDefaultAvatar(reply);
    }

    await generateFaceThumbnailAsync(id, faceToUse, fullPathToUse, cachedPath);

    if (fs.existsSync(cachedPath)) {
      reply.header('Content-Type', 'image/webp');
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.send(fs.createReadStream(cachedPath));
    }

    return sendDefaultAvatar(reply);
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
    const { q, query: searchQuery, limit, offset } = request.query as { q?: string; query?: string; limit?: string; offset?: string };
    const searchText = q || searchQuery;
    const maxResults = limit ? Math.min(200, Math.max(1, parseInt(limit, 10))) : 50;
    const offsetVal = offset ? Math.max(0, parseInt(offset, 10)) : 0;

    if (!searchText) {
      return reply.send([]);
    }

    const results = await SmartSearchService.searchMedia(searchText, maxResults, offsetVal);
    return reply.send(results);
  });

  // Smart Search Endpoint POST /api/search
  fastify.post('/api/search', { preHandler: requireAuth }, async (request, reply) => {
    const { q, query: searchQuery, limit, offset } = (request.body || {}) as { q?: string; query?: string; limit?: number; offset?: number };
    const searchText = q || searchQuery;
    const maxResults = limit ? Math.min(200, Math.max(1, limit)) : 50;
    const offsetVal = offset ? Math.max(0, offset) : 0;

    if (!searchText) {
      return reply.send([]);
    }

    const results = await SmartSearchService.searchMedia(searchText, maxResults, offsetVal);
    return reply.send(results);
  });

  // Vector smart search endpoint GET /api/search/smart
  fastify.get('/api/search/smart', { preHandler: requireAuth }, async (request, reply) => {
    const { mediaId, q, query: searchQuery, limit, offset } = request.query as { mediaId?: string; q?: string; query?: string; limit?: string; offset?: string };
    const maxResults = limit ? Math.min(200, Math.max(1, parseInt(limit, 10))) : 50;
    const offsetVal = offset ? Math.max(0, parseInt(offset, 10)) : 0;
    const searchText = q || searchQuery;

    if (searchText) {
      const results = await SmartSearchService.searchMedia(searchText, maxResults, offsetVal);
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

    const results = await SmartSearchService.findSimilarMedia(vectorStr, maxResults);
    return reply.send(results);
  });
}
