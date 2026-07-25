import { FastifyInstance } from 'fastify';
import { query } from '../../config/db';
import { requireAuth } from '../../utils/auth';

export async function mlRoutes(fastify: FastifyInstance) {
  
  // Get all unique people clusters (with a representative face image)
  fastify.get('/api/faces', { preHandler: requireAuth }, async (request, reply) => {
    const result = await query(`
      SELECT DISTINCT ON (f.person_id) 
        f.person_id, 
        f.media_id, 
        f.bounding_box,
        m.blurhash
      FROM face_embeddings f
      JOIN media_files m ON m.id = f.media_id
      ORDER BY f.person_id, f.created_at DESC
    `);
    
    return reply.send(result.rows);
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
  fastify.get<{ Params: { id: string } }>('/api/media/:id/faces', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    
    const result = await query(`
      SELECT person_id, bounding_box
      FROM face_embeddings
      WHERE media_id = $1
    `, [id]);
    
    return reply.send(result.rows);
  });
}
