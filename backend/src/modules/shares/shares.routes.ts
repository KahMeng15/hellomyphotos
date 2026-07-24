import { FastifyInstance } from 'fastify';
import { query } from '../../config/db';
import crypto from 'crypto';

export async function sharesRoutes(fastify: FastifyInstance) {
  fastify.post('/api/shares', async (request, reply) => {
    const { folderPath, allowDownload, watermarkEnabled, expiresAt } = request.body as any;
    
    const shareToken = crypto.randomBytes(16).toString('hex');
    
    await query(`
      INSERT INTO shared_folders (folder_path, share_token, allow_download, watermark_enabled, expires_at)
      VALUES ($1, $2, $3, $4, $5)
    `, [folderPath, shareToken, allowDownload ?? false, watermarkEnabled ?? false, expiresAt || null]);
    
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
    
    // Fetch folder contents
    const filesResult = await query(
      `SELECT * FROM media_files WHERE folder_path = $1 ORDER BY file_name ASC`, 
      [share.folder_path]
    );

    return reply.send({ share, files: filesResult.rows });
  });
}
