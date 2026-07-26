import { FastifyInstance } from 'fastify';
import { query } from '../../config/db';
import { requireAuth, verifyMediaAccess } from '../../utils/auth';
import { SmartSearchService } from './smartSearch.service';

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
        p.name
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
      return reply.send({ id, name: 'Unknown Person' });
    }
    return reply.send(result.rows[0]);
  });

  // Get all media files associated with a specific person
  fastify.get<{ Params: { id: string } }>('/api/faces/:id/media', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    
    const result = await query(`
      SELECT m.*, f.bounding_box
      FROM media_files m
      JOIN face_embeddings f ON m.id = f.media_id
      WHERE f.person_id = $1
      ORDER BY m.created_at DESC
    `, [id]);
    return reply.send(result.rows);
  });

  // Get all faces in a specific media file
  fastify.get<{ Params: { id: string }, Querystring: { shareToken?: string } }>('/api/media/:id/faces', async (request, reply) => {
    const { id } = request.params;
    
    if (!(await verifyMediaAccess(request, reply, id))) return;

    const result = await query(`
      SELECT person_id, bounding_box
      FROM face_embeddings
      WHERE media_id = $1
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
