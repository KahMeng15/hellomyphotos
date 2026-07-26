import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import { redis } from '../../config/redis';
import { scannerQueue } from '../../queue/scannerQueue';
import { mediaQueue } from '../../queue/mediaQueue';
import { query } from '../../config/db';
import { requireAuth, hasFolderAccess, canBrowseFolder } from '../../utils/auth';

const MEDIA_ROOT = process.env.MEDIA_ROOT || '/app/media';

export async function scannerRoutes(fastify: FastifyInstance) {
  
  fastify.post<{ Body: { folder: string, mediaId: string } }>('/api/folder/cover', { preHandler: requireAuth }, async (request, reply) => {
    const { folder, mediaId } = request.body;
    
    if (request.user?.role === 'viewer') {
      return reply.status(403).send({ error: 'Forbidden: Viewers cannot modify folder settings' });
    }
    if (!hasFolderAccess(request.user!, folder)) {
      return reply.status(403).send({ error: 'Forbidden: You do not have access to this folder' });
    }
    await query(`
      INSERT INTO folder_settings (folder_path, cover_media_id, updated_at) 
      VALUES ($1, $2, NOW()) 
      ON CONFLICT (folder_path) DO UPDATE 
      SET cover_media_id = EXCLUDED.cover_media_id, updated_at = NOW()
    `, [folder, mediaId]);
    
    return reply.send({ success: true });
  });

  fastify.post<{ Body: { folder: string, description: string } }>('/api/folder/settings', { preHandler: requireAuth }, async (request, reply) => {
    const { folder, description } = request.body;

    if (request.user?.role === 'viewer') {
      return reply.status(403).send({ error: 'Forbidden: Viewers cannot modify folder settings' });
    }
    if (!hasFolderAccess(request.user!, folder)) {
      return reply.status(403).send({ error: 'Forbidden: You do not have access to this folder' });
    }
    await query(`
      INSERT INTO folder_settings (folder_path, description, updated_at) 
      VALUES ($1, $2, NOW()) 
      ON CONFLICT (folder_path) DO UPDATE 
      SET description = EXCLUDED.description, updated_at = NOW()
    `, [folder, description]);
    
    return reply.send({ success: true });
  });

  fastify.post<{ Body: { folder: string } }>('/api/folder/rescan', { preHandler: requireAuth }, async (request, reply) => {
    const { folder } = request.body;

    if (request.user?.role === 'viewer') {
      return reply.status(403).send({ error: 'Forbidden: Viewers cannot trigger scans' });
    }
    if (!hasFolderAccess(request.user!, folder)) {
      return reply.status(403).send({ error: 'Forbidden: You do not have access to this folder' });
    }
    await scannerQueue.add('scan-directory', { folderPath: folder });
    return reply.send({ success: true });
  });

  fastify.post<{ Body: { folder: string } }>('/api/folder/rescan-ml', { preHandler: requireAuth }, async (request, reply) => {
    const { folder } = request.body;
    
    if (request.user?.role === 'viewer') {
      return reply.status(403).send({ error: 'Forbidden: Viewers cannot trigger ML scans' });
    }
    if (!hasFolderAccess(request.user!, folder)) {
      return reply.status(403).send({ error: 'Forbidden: You do not have access to this folder' });
    }
    
    // Trigger standard scan
    await scannerQueue.add('scan-directory', { folderPath: folder });
    
    // Queue ML processing for all media files in this folder
    const result = await query(
      `SELECT id, folder_path, file_name, mime_type FROM media_files WHERE folder_path = $1`, 
      [folder]
    );
    
    for (const row of result.rows) {
      await mediaQueue.add('process-media', { 
        mediaId: row.id, 
        fullPath: path.join(MEDIA_ROOT, row.folder_path, row.file_name),
        mimeType: row.mime_type 
      });
    }
    
    return reply.send({ success: true });
  });

  fastify.get<{ Params: { '*': string } }>('/api/folder/*', { preHandler: requireAuth }, async (request, reply) => {
    // URL decode the path param and sanitize
    const folderPath = decodeURIComponent(request.params['*'] || '');
    
    if (!canBrowseFolder(request.user!, folderPath)) {
      return reply.status(403).send({ error: 'Forbidden: You do not have access to this folder' });
    }
    
    // 1. Query Redis for Cooldown
    const cooldownKey = `scan_cooldown:${folderPath}`;
    const exists = await redis.exists(cooldownKey);
    
    if (!exists) {
      // 2. Set Cooldown & Push Job
      await redis.set(cooldownKey, '1', 'EX', 5); // 5 seconds
      await scannerQueue.add('scan-directory', { folderPath });
    }

    // 3. Serve Directory Tree from DB
    const result = await query(
      `SELECT * FROM media_files WHERE folder_path = $1 ORDER BY file_name ASC`, 
      [folderPath]
    );
    let files = result.rows;
    if (!hasFolderAccess(request.user!, folderPath)) {
      files = []; // Cannot see files in ancestor folders
    }

    // 4. Dynamically list subdirectories and find their cover images
    const fullPath = path.join(MEDIA_ROOT, folderPath);
    let directories: { name: string, cover_id: string | null, blurhash: string | null }[] = [];
    try {
      if (fs.existsSync(fullPath)) {
        const items = await fs.promises.readdir(fullPath, { withFileTypes: true });
        
        const dirNames = items.filter(item => item.isDirectory()).map(item => item.name);
        
        let validDirNames = dirNames.filter(name => {
          const subPath = folderPath ? `${folderPath}/${name}` : name;
          return canBrowseFolder(request.user!, subPath);
        });
        
        directories = await Promise.all(validDirNames.map(async (name) => {
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

          // Fallback: Find a media file inside this directory or its subdirectories, preferring landscape and more faces
          const coverResult = await query(`
            SELECT m.id, m.blurhash,
              (SELECT COUNT(*) FROM face_embeddings f WHERE f.media_id = m.id) as face_count,
              CASE 
                WHEN CAST(m.exif_json->>'ImageWidth' AS INTEGER) > CAST(m.exif_json->>'ImageHeight' AS INTEGER) THEN 1 
                WHEN CAST(m.exif_json->>'ExifImageWidth' AS INTEGER) > CAST(m.exif_json->>'ExifImageHeight' AS INTEGER) THEN 1 
                ELSE 0 
              END as is_landscape
            FROM media_files m 
            WHERE m.folder_path LIKE $1
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

    // 5. Get current folder's custom cover (if any) and description
    let folderCoverId = null;
    let folderDescription = '';
    if (folderPath !== null && folderPath !== undefined) {
      const currentFolderSettingsRes = await query(`SELECT cover_media_id, description FROM folder_settings WHERE folder_path = $1`, [folderPath]);
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
        WHERE m.folder_path = $1
        ORDER BY is_landscape DESC, face_count DESC, m.id ASC
        LIMIT 1
      `, [folderPath]);
      
      if (fallbackResult.rows.length > 0) {
        folderCoverId = fallbackResult.rows[0].id;
      }
    }

    return reply.send({
      folderPath,
      folderCoverId,
      folderDescription,
      scanning: !exists, // Indicate if a scan was just triggered
      files,
      directories
    });
  });
}
