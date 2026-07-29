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
        m.id, m.folder_path, m.file_name, m.mime_type, m.size_bytes, m.blurhash, m.exif_json, m.created_at,
        fs.cover_media_id AS folder_cover_id,
        COALESCE(
          (m.exif_json->>'dateTimeOriginal')::timestamp,
          (m.exif_json->>'DateTimeOriginal')::timestamp,
          (m.exif_json->>'createDate')::timestamp,
          (m.exif_json->>'CreateDate')::timestamp,
          (m.exif_json->>'modifyDate')::timestamp,
          (m.exif_json->>'ModifyDate')::timestamp,
          (m.exif_json->>'timestamp')::timestamp,
          m.created_at
        ) as sort_date
      FROM media_files m
      LEFT JOIN folder_settings fs ON fs.folder_path = m.folder_path
      WHERE (m.mime_type LIKE 'image/%' OR m.mime_type LIKE 'video/%')
      ${folderFilterSql}
      ORDER BY sort_date DESC
    `, queryParams);
    
    return reply.send({
      files: result.rows
    });
  });
}
