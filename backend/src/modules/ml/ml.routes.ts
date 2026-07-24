import { FastifyInstance } from 'fastify';
import { query } from '../../config/db';

export async function mlRoutes(fastify: FastifyInstance) {
  
  // Get all unique people clusters (with a representative face image)
  fastify.get('/api/faces', async (request, reply) => {
    const result = await query(`
      SELECT DISTINCT ON (person_id) 
        person_id, 
        media_id, 
        bounding_box 
      FROM face_embeddings
      ORDER BY person_id, created_at DESC
    `);
    
    return reply.send(result.rows);
  });

  // Get all media files associated with a specific person
  fastify.get<{ Params: { id: string } }>('/api/faces/:id/media', async (request, reply) => {
    const { id } = request.params;
    
    const result = await query(`
      SELECT m.* 
      FROM media_files m
      JOIN face_embeddings f ON m.id = f.media_id
      WHERE f.person_id = $1
      ORDER BY m.created_at DESC
    `, [id]);
    
    return reply.send(result.rows);
  });
}
