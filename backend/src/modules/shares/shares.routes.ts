import { FastifyInstance } from 'fastify';
import { query } from '../../config/db';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

const MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(process.cwd(), 'media');

export async function sharesRoutes(fastify: FastifyInstance) {
  fastify.post('/api/shares', async (request, reply) => {
    const { folderPath, mediaId, allowDownloadImages, allowDownloadFolder, watermarkEnabled, expiresAt } = request.body as any;
    
    const shareToken = crypto.randomBytes(16).toString('hex');
    
    await query(`
      INSERT INTO shared_folders (folder_path, media_id, share_token, allow_download_images, allow_download_folder, watermark_enabled, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [folderPath || null, mediaId || null, shareToken, allowDownloadImages ?? false, allowDownloadFolder ?? false, watermarkEnabled ?? false, expiresAt || null]);
    
    return reply.send({ shareToken });
  });

  async function handleShareGet(request: any, reply: any) {
    const { token } = request.params;
    const subPath = request.params['*'] ? decodeURIComponent(request.params['*']) : '';

    if (subPath.includes('..')) return reply.status(400).send({ error: 'Invalid path' });
    
    const result = await query(`
      SELECT * FROM shared_folders 
      WHERE share_token = $1 AND (expires_at IS NULL OR expires_at > NOW())
    `, [token]);
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Share not found or expired' });
    }
    
    const share = result.rows[0];
    
    if (share.media_id) {
      if (subPath) return reply.status(404).send({ error: 'Not a folder share' });
      const fileRes = await query(`SELECT * FROM media_files WHERE id = $1`, [share.media_id]);
      return reply.send({ share, files: fileRes.rows, folderCoverId: null });
    }
    
    let targetPath = share.folder_path || '';
    const baseFolderPath = targetPath;
    if (subPath) {
      targetPath = targetPath ? `${targetPath}/${subPath}` : subPath;
    }
    // Update share.folder_path to targetPath so the frontend sees the current folder
    share.folder_path = targetPath;

    // Fetch folder contents
    const filesResult = await query(
      `SELECT * FROM media_files WHERE folder_path = $1 ORDER BY file_name ASC`, 
      [targetPath]
    );

    const fullPath = path.join(MEDIA_ROOT, targetPath);
    let directories: { name: string, cover_id: string | null, blurhash: string | null }[] = [];
    try {
      if (fs.existsSync(fullPath)) {
        const items = await fs.promises.readdir(fullPath, { withFileTypes: true });
        
        const dirNames = items.filter(item => item.isDirectory()).map(item => item.name);
        
        directories = await Promise.all(dirNames.map(async (name) => {
          const subPath = share.folder_path ? `${share.folder_path}/${name}` : name;
          
          const customCoverRes = await query(`
            SELECT m.id, m.blurhash 
            FROM folder_settings fs
            JOIN media_files m ON m.id = fs.cover_media_id
            WHERE fs.folder_path = $1
          `, [subPath]);

          if (customCoverRes.rows.length > 0) {
            return {
              name,
              cover_id: customCoverRes.rows[0].id,
              blurhash: customCoverRes.rows[0].blurhash
            };
          }

          const coverResult = await query(`
            SELECT m.id, m.blurhash,
              (SELECT COUNT(*) FROM face_embeddings f WHERE f.media_id = m.id) as face_count,
              CASE 
                WHEN CAST(m.exif_json->>'ImageWidth' AS INTEGER) > CAST(m.exif_json->>'ImageHeight' AS INTEGER) THEN 1 
                WHEN CAST(m.exif_json->>'ExifImageWidth' AS INTEGER) > CAST(m.exif_json->>'ExifImageHeight' AS INTEGER) THEN 1 
                ELSE 0 
              END as is_landscape
            FROM media_files m 
            WHERE m.folder_path LIKE $1 AND m.mime_type LIKE 'image/%'
            ORDER BY is_landscape DESC, face_count DESC, m.id ASC
            LIMIT 1
          `, [`${subPath}%`]);
          
          return {
            name,
            cover_id: coverResult.rows[0]?.id || null,
            blurhash: coverResult.rows[0]?.blurhash || null
          };
        }));
        
        directories.sort((a, b) => a.name.localeCompare(b.name));
      }
    } catch (e) {
      console.error(`Failed to read directory: ${fullPath}`, e);
    }

    let folderCoverId = null;
    let folderDescription = '';
    
    if (share.folder_path !== null && share.folder_path !== undefined) {
      const currentFolderSettingsRes = await query(`SELECT cover_media_id, description FROM folder_settings WHERE folder_path = $1`, [share.folder_path]);
      if (currentFolderSettingsRes.rows.length > 0) {
        folderCoverId = currentFolderSettingsRes.rows[0].cover_media_id || null;
        folderDescription = currentFolderSettingsRes.rows[0].description || '';
      }
    }

    if (!folderCoverId) {
      const fallbackResult = await query(`
        SELECT m.id,
          (SELECT COUNT(*) FROM face_embeddings f WHERE f.media_id = m.id) as face_count,
          CASE 
            WHEN CAST(m.exif_json->>'ImageWidth' AS INTEGER) > CAST(m.exif_json->>'ImageHeight' AS INTEGER) THEN 1 
            WHEN CAST(m.exif_json->>'ExifImageWidth' AS INTEGER) > CAST(m.exif_json->>'ExifImageHeight' AS INTEGER) THEN 1 
            ELSE 0 
          END as is_landscape
        FROM media_files m 
        WHERE m.folder_path = $1 AND m.mime_type LIKE 'image/%'
        ORDER BY is_landscape DESC, face_count DESC, m.id ASC
        LIMIT 1
      `, [share.folder_path]);
      
      if (fallbackResult.rows.length > 0) {
        folderCoverId = fallbackResult.rows[0].id;
      }
    }

    return reply.send({ share, files: filesResult.rows, directories, folderCoverId, folderDescription, folderPath: targetPath, baseFolderPath });
  }

  fastify.get<{ Params: { token: string } }>('/api/shares/:token', handleShareGet);
  fastify.get<{ Params: { token: string, '*': string } }>('/api/shares/:token/*', handleShareGet);

  fastify.get<{ Params: { '*': string } }>('/api/shares/folder/*', async (request, reply) => {
    const folderPath = decodeURIComponent(request.params['*'] || '');
    
    const result = await query(`
      SELECT id, share_token, allow_download_images, allow_download_folder, watermark_enabled, expires_at, created_at 
      FROM shared_folders 
      WHERE folder_path = $1
      ORDER BY created_at DESC
    `, [folderPath]);
    
    return reply.send({ shares: result.rows });
  });

  fastify.delete<{ Params: { token: string } }>('/api/shares/:token', async (request, reply) => {
    const { token } = request.params;
    
    await query(`DELETE FROM shared_folders WHERE share_token = $1`, [token]);
    
    return reply.send({ success: true });
  });
}
