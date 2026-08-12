import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { redis } from '../../config/redis';
import { scannerQueue } from '../../queue/scannerQueue';
import { mediaQueue } from '../../queue/mediaQueue';
import { metadataQueue } from '../../queue/metadataQueue';
import { thumbnailQueue } from '../../queue/thumbnailQueue';
import { videoQueue } from '../../queue/videoQueue';
import { query } from '../../config/db';
import { requireAuth, hasFolderAccess, canBrowseFolder } from '../../utils/auth';
import { logger } from '../../utils/logger';

const MEDIA_ROOT = process.env.MEDIA_ROOT || '/app/media';

function profileLabel(folderPath: string, step: string) {
  return `[FOLDER_PROFILE] ${JSON.stringify(folderPath)} :: ${step}`;
}

export async function scannerRoutes(fastify: FastifyInstance) {
  
  fastify.post<{ Body: { folder: string, mediaId: string } }>('/api/folder/cover', { preHandler: requireAuth }, async (request, reply) => {
    const { folder, mediaId } = request.body;
    
    if (request.user?.role === 'viewer') {
      return reply.status(403).send({ error: 'Forbidden: Viewers cannot modify folder settings' });
    }
    if (!hasFolderAccess(request.user!, folder)) {
      return reply.status(403).send({ error: 'Forbidden: You do not have access to this folder' });
    }
    const paths = [folder];
    let currentPath = folder;
    while (currentPath.includes('/')) {
      currentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
      paths.push(currentPath);
    }
    if (folder !== '') paths.push('');

    for (const p of paths) {
      await query(`
        INSERT INTO folder_settings (folder_path, cover_media_id, updated_at) 
        VALUES ($1, $2, NOW()) 
        ON CONFLICT (folder_path) DO UPDATE 
        SET cover_media_id = EXCLUDED.cover_media_id, updated_at = NOW()
      `, [p, mediaId]);
    }
    
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
    const t0 = performance.now();
    
    if (!canBrowseFolder(request.user!, folderPath)) {
      return reply.status(403).send({ error: 'Forbidden: You do not have access to this folder' });
    }

    const mark = (name: string) => {
      logger.info(profileLabel(folderPath, name), { ms: Math.round(performance.now() - t0) });
    };
    
    // 1. Query Redis for Cooldown
    const cooldownKey = `scan_cooldown:${folderPath}`;
    const exists = await redis.exists(cooldownKey);
    mark('1_redis_cooldown');
    
    if (!exists) {
      // 2. Set Cooldown & Push Job
      // M-6 Fix: Increased cooldown from 5s to 30s to reduce background scan churn
      // when multiple users are browsing folders concurrently.
      await redis.set(cooldownKey, '1', 'EX', 30); // 30 seconds
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
    } else {
      // Prioritize processing for files in this actively navigated folder
      const missingMetadata = files.filter(f => f.exif_json == null);
      const missingThumbs = files.filter(f => !f.has_480p || !f.has_1080p);

      Promise.all(missingMetadata.map(f => 
        metadataQueue.add('extract-metadata', { 
          mediaId: f.id, 
          fullPath: path.join(MEDIA_ROOT, f.folder_path || '', f.file_name), 
          mimeType: f.mime_type 
        }, { priority: 2 })
      )).catch(err => logger.error('Failed to queue high-priority metadata jobs', err));

      Promise.all(missingThumbs.map(f => {
        const fullPath = path.join(MEDIA_ROOT, f.folder_path || '', f.file_name);
        if (f.mime_type.startsWith('video/')) {
          return videoQueue.add('process-video', { mediaId: f.id, fullPath, mimeType: f.mime_type }, { priority: 2 });
        } else {
          return thumbnailQueue.add('generate-thumbnail', { mediaId: f.id, fullPath, mimeType: f.mime_type }, { priority: 2 });
        }
      })).catch(err => logger.error('Failed to queue high-priority thumbnail jobs', err));
    }
    mark('2_db_files');

    // 4. Dynamically list subdirectories and find their cover images
    const fullPath = path.join(MEDIA_ROOT, folderPath);
    let directories: { name: string, cover_id: string | null, blurhash: string | null }[] = [];
    let hostError: string | null = null;
    try {
      const items = await fs.promises.readdir(fullPath, { withFileTypes: true });
      
      const dirNames = items.filter(item => item.isDirectory()).map(item => item.name);
        
        let validDirNames = dirNames.filter(name => {
          const subPath = folderPath ? `${folderPath}/${name}` : name;
          return canBrowseFolder(request.user!, subPath);
        });
        
        directories = await Promise.all(validDirNames.map(async (name) => {
          const subPath = folderPath ? `${folderPath}/${name}` : name;
          
          // Check if there is a custom cover OR cached auto cover in folder_settings
          const customCoverRes = await query(`
            SELECT m.id, m.blurhash,
              COALESCE(m.img_width, (m.exif_json->>'width')::int) AS img_width,
              COALESCE(m.img_height, (m.exif_json->>'height')::int) AS img_height,
              (SELECT bounding_box FROM face_embeddings WHERE media_id = m.id ORDER BY created_at DESC LIMIT 1) as bounding_box
            FROM folder_settings fs
            JOIN media_files m ON m.id = COALESCE(fs.cover_media_id, fs.auto_cover_media_id)
            WHERE fs.folder_path = $1
          `, [subPath]);

          if (customCoverRes.rows.length > 0) {
            return {
              name,
              cover_id: customCoverRes.rows[0].id,
              blurhash: customCoverRes.rows[0].blurhash,
              cover_bounding_box: customCoverRes.rows[0].bounding_box,
              cover_img_width: customCoverRes.rows[0].img_width,
              cover_img_height: customCoverRes.rows[0].img_height
            };
          }

          // Not cached. Check if processing is active for this folder or subfolders.
          const isProcessingRes = await query(`
            SELECT 1 FROM media_files 
            WHERE folder_path LIKE $1 AND blurhash IS NULL 
            LIMIT 1
          `, [`${subPath}%`]);
          
          let coverResult;
          
          if (isProcessingRes.rows.length > 0) {
            // Processing is active. Choose a fast "random" image (first found). Do not cache.
            coverResult = await query(`
              SELECT m.id, m.blurhash,
                COALESCE(m.img_width, (m.exif_json->>'width')::int) AS img_width,
                COALESCE(m.img_height, (m.exif_json->>'height')::int) AS img_height,
                (SELECT bounding_box FROM face_embeddings WHERE media_id = m.id ORDER BY created_at DESC LIMIT 1) as bounding_box
              FROM media_files m 
              WHERE m.folder_path LIKE $1
              ORDER BY m.id ASC
              LIMIT 1
            `, [`${subPath}%`]);
          } else {
            // Processing finished. Compute the smart cover.
            coverResult = await query(`
              SELECT m.id, m.blurhash,
                COALESCE(m.img_width, (m.exif_json->>'width')::int) AS img_width,
                COALESCE(m.img_height, (m.exif_json->>'height')::int) AS img_height,
                (SELECT COUNT(*) FROM face_embeddings f WHERE f.media_id = m.id) as face_count,
                (SELECT bounding_box FROM face_embeddings WHERE media_id = m.id ORDER BY created_at DESC LIMIT 1) as bounding_box,
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
            
            if (coverResult.rows.length > 0) {
              // Cache it!
              await query(`
                INSERT INTO folder_settings (folder_path, auto_cover_media_id)
                VALUES ($1, $2)
                ON CONFLICT (folder_path) DO UPDATE SET auto_cover_media_id = EXCLUDED.auto_cover_media_id
              `, [subPath, coverResult.rows[0].id]);
            }
          }
          
          return {
            name,
            cover_id: coverResult.rows[0]?.id || null,
            blurhash: coverResult.rows[0]?.blurhash || null,
            cover_bounding_box: coverResult.rows[0]?.bounding_box || null,
            cover_img_width: coverResult.rows[0]?.img_width || null,
            cover_img_height: coverResult.rows[0]?.img_height || null
          };
        }));
        
        directories.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
        console.error(`Failed to read directory: ${fullPath}`, e);
        hostError = `Storage access error: ${e.message}`;
      }
    }
    mark('3_directories');

    // 5. Get current folder's custom cover (if any) and description
    let folderCoverId = null;
    let folderCoverBoundingBox: any = null;
    let folderCoverImgWidth: number | null = null;
    let folderCoverImgHeight: number | null = null;
    let folderDescription = '';
    if (folderPath !== null && folderPath !== undefined) {
      const currentFolderSettingsRes = await query(`
        SELECT cover_media_id, auto_cover_media_id, description 
        FROM folder_settings WHERE folder_path = $1
      `, [folderPath]);
      if (currentFolderSettingsRes.rows.length > 0) {
        folderCoverId = currentFolderSettingsRes.rows[0].cover_media_id || currentFolderSettingsRes.rows[0].auto_cover_media_id || null;
        folderDescription = currentFolderSettingsRes.rows[0].description || '';
      }
    }
    mark('4_folder_settings');

    if (!folderCoverId) {
      // Check if processing is active for the current folder
      const isProcessingRes = await query(`SELECT 1 FROM media_files WHERE folder_path = $1 AND blurhash IS NULL LIMIT 1`, [folderPath]);
      
      let fallbackResult;
      if (isProcessingRes.rows.length > 0) {
        // Active processing: fast random image
        fallbackResult = await query(`SELECT id FROM media_files WHERE folder_path = $1 ORDER BY id ASC LIMIT 1`, [folderPath]);
      } else {
        // Processing finished: smart logic
        fallbackResult = await query(`
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
        
        if (fallbackResult.rows.length > 0 && folderPath) {
           await query(`
              INSERT INTO folder_settings (folder_path, auto_cover_media_id)
              VALUES ($1, $2)
              ON CONFLICT (folder_path) DO UPDATE SET auto_cover_media_id = EXCLUDED.auto_cover_media_id
           `, [folderPath, fallbackResult.rows[0].id]);
        }
      }
      
      if (fallbackResult.rows.length > 0) {
        folderCoverId = fallbackResult.rows[0].id;
      }
    }

    // Look up bounding box + dims for the cover image
    if (folderCoverId) {
      const bbRes = await query(`
        SELECT (
          SELECT bounding_box FROM face_embeddings
          WHERE media_id = $1
          ORDER BY created_at DESC LIMIT 1
        ) AS bounding_box,
        COALESCE(img_width, (exif_json->>'width')::int) AS img_width,
        COALESCE(img_height, (exif_json->>'height')::int) AS img_height
        FROM media_files WHERE id = $1
      `, [folderCoverId]);
      if (bbRes.rows.length > 0) {
        folderCoverBoundingBox = bbRes.rows[0].bounding_box;
        folderCoverImgWidth = bbRes.rows[0].img_width;
        folderCoverImgHeight = bbRes.rows[0].img_height;
        console.log('[folder] cover lookup for', folderCoverId, JSON.stringify(bbRes.rows[0]));
      } else {
        console.log('[folder] cover query returned 0 rows for', folderCoverId);
      }
      // Fallback: read dimensions from file if EXIF is null
      if (!folderCoverImgWidth || !folderCoverImgHeight) {
        try {
          const fileRow = await query('SELECT folder_path, file_name FROM media_files WHERE id = $1', [folderCoverId]);
          if (fileRow.rows.length > 0) {
            const fPath = path.join(MEDIA_ROOT, fileRow.rows[0].folder_path || '', fileRow.rows[0].file_name);
            const meta = await sharp(fPath).metadata();
            if (meta.width) folderCoverImgWidth = meta.width;
            if (meta.height) folderCoverImgHeight = meta.height;
          }
        } catch (e) {
          // non-critical
        }
      }
    }
    mark('5_folder_cover');

    const defaultsRes = await query("SELECT key, value FROM admin_settings WHERE key = ANY($1)", [
      ['default_view_mode', 'default_sort_mode', 'default_folder_view_mode']
    ]);
    const defaults: Record<string, string> = {
      defaultViewMode: 'small-fit',
      defaultSortMode: 'oldest',
      defaultFolderViewMode: 'small-grid'
    };
    for (const r of defaultsRes.rows) {
      if (r.key === 'default_view_mode') defaults.defaultViewMode = r.value;
      if (r.key === 'default_sort_mode') defaults.defaultSortMode = r.value;
      if (r.key === 'default_folder_view_mode') defaults.defaultFolderViewMode = r.value;
    }

    const processingRes = await query(`
      SELECT COUNT(*) as count 
      FROM media_files 
      WHERE (folder_path = $1 OR folder_path LIKE $1 || '/%') AND (exif_json IS NULL OR blurhash IS NULL)
    `, [folderPath || '']);
    const isProcessing = parseInt(processingRes.rows[0].count) > 0;
    mark('6_processing_count');
    mark('total');

    return reply.send({
      folderPath,
      isProcessing,
      folderCoverId,
      folderCoverBoundingBox,
      folderCoverImgWidth,
      folderCoverImgHeight,
      folderDescription,
      scanning: !exists, // Indicate if a scan was just triggered
      files,
      directories,
      hostError,
      defaultViewMode: defaults.defaultViewMode,
      defaultSortMode: defaults.defaultSortMode,
      defaultFolderViewMode: defaults.defaultFolderViewMode
    });
  });
}
