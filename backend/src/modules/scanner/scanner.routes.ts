import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import { redis } from '../../config/redis';
import { scannerQueue } from '../../queue/scannerQueue';
import { query } from '../../config/db';

const MEDIA_ROOT = process.env.MEDIA_ROOT || '/app/media';

export async function scannerRoutes(fastify: FastifyInstance) {
  
  fastify.post<{ Body: { folder: string, mediaId: string } }>('/api/folder/cover', async (request, reply) => {
    const { folder, mediaId } = request.body;
    await query(`
      INSERT INTO folder_settings (folder_path, cover_media_id, updated_at) 
      VALUES ($1, $2, NOW()) 
      ON CONFLICT (folder_path) DO UPDATE 
      SET cover_media_id = EXCLUDED.cover_media_id, updated_at = NOW()
    `, [folder, mediaId]);
    
    return reply.send({ success: true });
  });

  fastify.get<{ Params: { '*': string } }>('/api/folder/*', async (request, reply) => {
    // URL decode the path param and sanitize
    const folderPath = decodeURIComponent(request.params['*'] || '');
    
    // 1. Query Redis for Cooldown
    const cooldownKey = `scan_cooldown:${folderPath}`;
    const exists = await redis.exists(cooldownKey);
    
    if (!exists) {
      // 2. Set Cooldown & Push Job
      await redis.set(cooldownKey, '1', 'EX', 60); // 60 seconds
      await scannerQueue.add('scan-directory', { folderPath });
    }

    // 3. Serve Directory Tree from DB
    const result = await query(
      `SELECT * FROM media_files WHERE folder_path = $1 ORDER BY file_name ASC`, 
      [folderPath]
    );

    // 4. Dynamically list subdirectories and find their cover images
    const fullPath = path.join(MEDIA_ROOT, folderPath);
    let directories: { name: string, cover_id: string | null, blurhash: string | null }[] = [];
    try {
      if (fs.existsSync(fullPath)) {
        const items = await fs.promises.readdir(fullPath, { withFileTypes: true });
        
        const dirNames = items.filter(item => item.isDirectory()).map(item => item.name);
        
        directories = await Promise.all(dirNames.map(async (name) => {
          const subPath = folderPath ? `${folderPath}/${name}` : name;
          
          // Check if there is a custom cover in folder_settings
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

          // Fallback: Find the first media file inside this directory or its subdirectories
          const coverResult = await query(`SELECT id, blurhash FROM media_files WHERE folder_path LIKE $1 LIMIT 1`, [`${subPath}%`]);
          
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

    // 5. Get current folder's custom cover (if any)
    let folderCoverId = null;
    if (folderPath) {
      const currentFolderCoverRes = await query(`SELECT cover_media_id FROM folder_settings WHERE folder_path = $1`, [folderPath]);
      if (currentFolderCoverRes.rows.length > 0) {
        folderCoverId = currentFolderCoverRes.rows[0].cover_media_id;
      }
    }

    return reply.send({
      folderPath,
      folderCoverId,
      scanning: !exists, // Indicate if a scan was just triggered
      files: result.rows,
      directories
    });
  });
}
