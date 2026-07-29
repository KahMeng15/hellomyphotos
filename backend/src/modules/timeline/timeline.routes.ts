import { FastifyInstance } from 'fastify';
import { query } from '../../config/db';
import { requireAuth } from '../../utils/auth';

export async function timelineRoutes(fastify: FastifyInstance) {
  fastify.get('/api/timeline', { preHandler: requireAuth }, async (request, reply) => {
    // Fetch all media files, ordered by their EXIF dateTimeOriginal descending.
    // If exif_json is null or missing dateTimeOriginal, fall back to created_at (or nulls last).
    let folderFilterSql = '';
    const queryParams: any[] = [];
    
    if (request.user?.role !== 'admin' && request.user?.role !== 'super_admin' && !request.user?.folders.includes('*')) {
      const folders = request.user?.folders || [];
      const folderConditions = folders.map((folder) => {
        queryParams.push(folder, `${folder}/%`);
        return `(folder_path = $${queryParams.length - 1} OR folder_path LIKE $${queryParams.length})`;
      });
      
      if (folderConditions.length > 0) {
        folderFilterSql = `AND (${folderConditions.join(' OR ')})`;
      } else {
        folderFilterSql = `AND 1 = 0`; // No access
      }
    }

    const result = await query(`
      SELECT 
        id, folder_path, file_name, mime_type, size_bytes, blurhash, exif_json, created_at,
        COALESCE(
          (exif_json->>'dateTimeOriginal')::timestamp,
          (exif_json->>'DateTimeOriginal')::timestamp,
          (exif_json->>'createDate')::timestamp,
          (exif_json->>'CreateDate')::timestamp,
          (exif_json->>'modifyDate')::timestamp,
          (exif_json->>'ModifyDate')::timestamp,
          (exif_json->>'timestamp')::timestamp,
          created_at
        ) as sort_date
      FROM media_files
      WHERE (mime_type LIKE 'image/%' OR mime_type LIKE 'video/%')
      ${folderFilterSql}
      ORDER BY sort_date DESC
    `, queryParams);
    
    return reply.send({
      files: result.rows
    });
  });
}
