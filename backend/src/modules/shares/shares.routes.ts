import { FastifyInstance } from 'fastify';
import { query } from '../../config/db';
import crypto from 'crypto';

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

  fastify.get<{ Params: { token: string } }>('/api/shares/:token', async (request, reply) => {
    const { token } = request.params;
    
    const result = await query(`
      SELECT * FROM shared_folders 
      WHERE share_token = $1 AND (expires_at IS NULL OR expires_at > NOW())
    `, [token]);
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Share not found or expired' });
    }
    
    const share = result.rows[0];
    
    if (share.media_id) {
      const fileRes = await query(`SELECT * FROM media_files WHERE id = $1`, [share.media_id]);
      return reply.send({ share, files: fileRes.rows, folderCoverId: null });
    }
    
    // Fetch folder contents
    const filesResult = await query(
      `SELECT * FROM media_files WHERE folder_path = $1 ORDER BY file_name ASC`, 
      [share.folder_path]
    );

    // Fetch folder cover
    let folderCoverId = null;
    const currentFolderSettingsRes = await query(`SELECT cover_media_id FROM folder_settings WHERE folder_path = $1`, [share.folder_path]);
    if (currentFolderSettingsRes.rows.length > 0) {
      folderCoverId = currentFolderSettingsRes.rows[0].cover_media_id;
    }

    return reply.send({ share, files: filesResult.rows, folderCoverId });
  });

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
