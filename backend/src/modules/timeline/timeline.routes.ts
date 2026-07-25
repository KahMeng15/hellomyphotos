import { FastifyInstance } from 'fastify';
import { query } from '../../config/db';
import { requireAuth } from '../../utils/auth';

export async function timelineRoutes(fastify: FastifyInstance) {
  fastify.get('/api/timeline', { preHandler: requireAuth }, async (request, reply) => {
    // Fetch all media files, ordered by their EXIF dateTimeOriginal descending.
    // If exif_json is null or missing dateTimeOriginal, fall back to created_at (or nulls last).
    const result = await query(`
      SELECT 
        id, folder_path, file_name, mime_type, size_bytes, blurhash, exif_json,
        COALESCE(
          (exif_json->>'dateTimeOriginal')::timestamp,
          created_at
        ) as sort_date
      FROM media_files
      WHERE mime_type LIKE 'image/%' OR mime_type LIKE 'video/%'
      ORDER BY sort_date DESC
    `);
    
    return reply.send({
      files: result.rows
    });
  });
}
