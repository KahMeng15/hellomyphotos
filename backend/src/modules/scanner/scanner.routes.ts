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

function profileLabel(folder: string, step: string) {
  return `[FOLDER_PROFILE] ${JSON.stringify(folder)} :: ${step}`;
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
      if (p === folder) {
        await query(`
          INSERT INTO folder_settings (folder_path, cover_media_id, updated_at) 
          VALUES ($1, $2, NOW()) 
          ON CONFLICT (folder_path) DO UPDATE 
          SET cover_media_id = EXCLUDED.cover_media_id, updated_at = NOW()
        `, [p, mediaId]);
      } else {
        const parentRes = await query(`
          SELECT fs.cover_media_id, mf.folder_path as media_folder
          FROM folder_settings fs
          LEFT JOIN media_files mf ON mf.id = fs.cover_media_id
          WHERE fs.folder_path = $1
        `, [p]);
        
        const parent = parentRes.rows[0];
        const shouldUpdate = !parent?.cover_media_id || (parent.media_folder && (parent.media_folder === folder || parent.media_folder.startsWith(folder + '/')));
        
        if (shouldUpdate) {
          await query(`
            INSERT INTO folder_settings (folder_path, cover_media_id, updated_at) 
            VALUES ($1, $2, NOW()) 
            ON CONFLICT (folder_path) DO UPDATE 
            SET cover_media_id = EXCLUDED.cover_media_id, updated_at = NOW()
          `, [p, mediaId]);
        }
      }
      try {
        await redis.del(`folder_dirs_v2:${p}`).catch(() => {});
        const parent = p.includes('/') ? p.substring(0, p.lastIndexOf('/')) : '';
        await redis.del(`folder_dirs_v2:${parent}`).catch(() => {});
      } catch (cacheErr) {
        // non-critical
      }
    }

    try {
      const ogDir = path.resolve(process.env.MEDIA_ROOT || '/app/media', '../cache/og');
      if (fs.existsSync(ogDir)) {
        if (folder === '') {
          fs.rmSync(ogDir, { recursive: true, force: true });
          fs.mkdirSync(ogDir, { recursive: true });
        } else {
          const safePathBase = folder.replace(/[^a-zA-Z0-9-_\.]/g, '_');
          const files = fs.readdirSync(ogDir);
          for (const file of files) {
            if (file.endsWith(`_${safePathBase}.png`) || file.includes(`_${safePathBase}_`)) {
              fs.unlinkSync(path.join(ogDir, file));
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to clear OG cache', e);
    }
    
    return reply.send({ success: true });
  });

  fastify.post<{ Body: { folder?: string } }>('/api/folder/regenerate-og', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const folder = request.body?.folder || '';
      const ogDir = path.resolve(process.env.MEDIA_ROOT || '/app/media', '../cache/og');
      
      if (fs.existsSync(ogDir)) {
        if (folder === '') {
          // If it's the absolute root, clear everything
          fs.rmSync(ogDir, { recursive: true, force: true });
          fs.mkdirSync(ogDir, { recursive: true });
        } else {
          const safePathBase = folder.replace(/[^a-zA-Z0-9-_\.]/g, '_');
          const files = fs.readdirSync(ogDir);
          for (const file of files) {
            // Delete if it matches this exact folder or any of its subfolders
            if (file.endsWith(`_${safePathBase}.png`) || file.includes(`_${safePathBase}_`)) {
              fs.unlinkSync(path.join(ogDir, file));
            }
          }
        }
      }
      return reply.send({ success: true });
    } catch (e) {
      console.error('Failed to clear specific OG cache', e);
      return reply.status(500).send({ error: 'Failed to clear cache' });
    }
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
    
    try {
      await redis.del(`folder_dirs_v2:${folder}`).catch(() => {});
      const parent = folder.includes('/') ? folder.substring(0, folder.lastIndexOf('/')) : '';
      await redis.del(`folder_dirs_v2:${parent}`).catch(() => {});
    } catch (cacheErr) {
      // non-critical
    }

    return reply.send({ success: true });
  });

  fastify.post<{ Body: { folder: string } }>('/api/folder/regenerate-images', { preHandler: requireAuth }, async (request, reply) => {
    const { folder } = request.body;

    if (request.user?.role === 'viewer') {
      return reply.status(403).send({ error: 'Forbidden: Viewers cannot trigger scans' });
    }
    if (!hasFolderAccess(request.user!, folder)) {
      return reply.status(403).send({ error: 'Forbidden: You do not have access to this folder' });
    }

    let result;
    if (!folder || folder === '') {
      result = await query(`
        UPDATE media_files 
        SET has_480p = false, has_1080p = false 
        WHERE mime_type LIKE 'image/%'
        RETURNING id, folder_path, file_name, mime_type
      `);
    } else {
      result = await query(`
        UPDATE media_files 
        SET has_480p = false, has_1080p = false 
        WHERE (folder_path = $1 OR folder_path LIKE $2) 
        AND mime_type LIKE 'image/%'
        RETURNING id, folder_path, file_name, mime_type
      `, [folder, `${folder}/%`]);
    }

    const CACHE_ROOT = process.env.CACHE_ROOT || '/app/cache';
    for (const row of result.rows) {
      try {
        const p480 = path.join(CACHE_ROOT, '480p', `${row.id}.webp`);
        const p1080 = path.join(CACHE_ROOT, '1080p', `${row.id}.webp`);
        if (fs.existsSync(p480)) fs.unlinkSync(p480);
        if (fs.existsSync(p1080)) fs.unlinkSync(p1080);
      } catch (e) {
        console.warn('Failed to delete cache files', e);
      }

      const fullPath = path.join(MEDIA_ROOT, row.folder_path, row.file_name);
      await thumbnailQueue.add('generate-thumbnail', { mediaId: row.id, fullPath, mimeType: row.mime_type }, { priority: 2 }).catch(() => {});
    }

    return reply.send({ success: true, count: result.rows.length });
  });

  fastify.post<{ Body: { folder: string } }>('/api/folder/regenerate-videos', { preHandler: requireAuth }, async (request, reply) => {
    const { folder } = request.body;

    if (request.user?.role === 'viewer') {
      return reply.status(403).send({ error: 'Forbidden: Viewers cannot trigger scans' });
    }
    if (!hasFolderAccess(request.user!, folder)) {
      return reply.status(403).send({ error: 'Forbidden: You do not have access to this folder' });
    }

    let result;
    if (!folder || folder === '') {
      result = await query(`
        UPDATE media_files 
        SET has_480p = false, has_1080p = false, is_transcoded = false
        WHERE mime_type LIKE 'video/%'
        RETURNING id, folder_path, file_name, mime_type
      `);
    } else {
      result = await query(`
        UPDATE media_files 
        SET has_480p = false, has_1080p = false, is_transcoded = false
        WHERE (folder_path = $1 OR folder_path LIKE $2) 
        AND mime_type LIKE 'video/%'
        RETURNING id, folder_path, file_name, mime_type
      `, [folder, `${folder}/%`]);
    }

    const CACHE_ROOT = process.env.CACHE_ROOT || '/app/cache';
    for (const row of result.rows) {
      try {
        const p480 = path.join(CACHE_ROOT, '480p', `${row.id}.webp`);
        const pMp4 = path.join(CACHE_ROOT, 'transcoded', 'mp4', `${row.id}.mp4`);
        const pWebm = path.join(CACHE_ROOT, 'transcoded', 'webm', `${row.id}.webm`);
        if (fs.existsSync(p480)) fs.unlinkSync(p480);
        if (fs.existsSync(pMp4)) fs.unlinkSync(pMp4);
        if (fs.existsSync(pWebm)) fs.unlinkSync(pWebm);
      } catch (e) {
        console.warn('Failed to delete cache files', e);
      }

      const fullPath = path.join(MEDIA_ROOT, row.folder_path, row.file_name);
      await videoQueue.add('process-video', { mediaId: row.id, fullPath, mimeType: row.mime_type, skipCascade: true }, { priority: 2 }).catch(() => {});
    }

    return reply.send({ success: true, count: result.rows.length });
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
    const folder = decodeURIComponent(request.params['*'] || '');
    const t0 = performance.now();
    
    if (!canBrowseFolder(request.user!, folder)) {
      return reply.status(403).send({ error: 'Forbidden: You do not have access to this folder' });
    }

    const mark = (name: string) => {
      logger.info(profileLabel(folder, name), { ms: Math.round(performance.now() - t0) });
    };
    
    // 1. Query Redis for Cooldown
    const cooldownKey = `scan_cooldown:${folder}`;
    const exists = await redis.exists(cooldownKey);
    mark('1_redis_cooldown');
    
    if (!exists) {
      // 2. Set Cooldown & Push Job
      // M-6 Fix: Increased cooldown from 5s to 30s to reduce background scan churn
      // when multiple users are browsing folders concurrently.
      await redis.set(cooldownKey, '1', 'EX', 30); // 30 seconds
      await scannerQueue.add('scan-directory', { folderPath: folder });
    }

    // 3. Serve Directory Tree from DB
    const result = await query(
      `SELECT id, folder_path, file_name, mime_type, size_bytes, blurhash, exif_json, has_1080p, has_480p, is_transcoded, transcoded_mp4_path, transcoded_webm_path, created_at, updated_at, img_width, img_height FROM media_files WHERE folder_path = $1 ORDER BY file_name ASC`, 
      [folder]
    );
    let files = result.rows;
    if (!hasFolderAccess(request.user!, folder)) {
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
    const resolvedMediaRoot = path.resolve(MEDIA_ROOT);
    const cleanFolder = path.normalize(folder || '').replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.resolve(resolvedMediaRoot, cleanFolder);
    if (!fullPath.startsWith(resolvedMediaRoot)) {
      return reply.status(400).send({ error: 'Invalid folder path' });
    }
    let directories: { name: string, cover_id: string | null, blurhash: string | null, cover_bounding_box?: any, cover_img_width?: number | null, cover_img_height?: number | null }[] = [];
    let hostError: string | null = null;
    const cacheKey = `folder_dirs_v2:${folder}`;

    try {
      const cachedDirs = await redis.get(cacheKey);
      if (cachedDirs) {
        try {
          const parsed = JSON.parse(cachedDirs);
          directories = parsed.filter((d: any) => {
            const subPath = folder ? `${folder}/${d.name}` : d.name;
            return canBrowseFolder(request.user!, subPath);
          });
        } catch (e) {
          // ignore cache parse error
        }
      }

      if (!cachedDirs) {
        let dirNames: string[] = [];
        try {
          let dirRes;
          if (folder === '') {
            dirRes = await query(`
              SELECT DISTINCT dir_name FROM (
                SELECT split_part(folder_path, '/', 1) AS dir_name
                FROM media_files
                WHERE folder_path != '' AND folder_path IS NOT NULL
                UNION
                SELECT split_part(folder_path, '/', 1) AS dir_name
                FROM folder_settings
                WHERE folder_path != '' AND folder_path IS NOT NULL
              ) sub
              WHERE dir_name != '' AND dir_name IS NOT NULL
              ORDER BY dir_name ASC
            `);
          } else {
            const escapedFolder = folder.replace(/([%_\\])/g, '\\$1');
            dirRes = await query(`
              SELECT DISTINCT dir_name FROM (
                SELECT split_part(substring(folder_path from length($1) + 2), '/', 1) AS dir_name
                FROM media_files
                WHERE folder_path LIKE $2 ESCAPE '\\' AND folder_path != $1
                UNION
                SELECT split_part(substring(folder_path from length($1) + 2), '/', 1) AS dir_name
                FROM folder_settings
                WHERE folder_path LIKE $2 ESCAPE '\\' AND folder_path != $1
              ) sub
              WHERE dir_name != '' AND dir_name IS NOT NULL
              ORDER BY dir_name ASC
            `, [folder, `${escapedFolder}/%`]);
          }
          dirNames = dirRes.rows.map(r => r.dir_name);
        } catch (dbErr: any) {
          logger.error('Failed to query directories from DB', dbErr);
        }

        // Fallback to filesystem if DB returned 0 directories (e.g. unindexed on disk)
        if (dirNames.length === 0) {
          try {
            const items = await fs.promises.readdir(fullPath, { withFileTypes: true });
            dirNames = items
              .filter(item => item.isDirectory() && !item.name.startsWith('.'))
              .map(item => item.name);
          } catch (e: any) {
            if (e.code !== 'ENOENT') {
              console.error('Failed to read directory:', fullPath, e);
              hostError = `Storage access error: ${e.message}`;
            }
          }
        }

        const validDirNames = dirNames.filter(name => {
          const subPath = folder ? `${folder}/${name}` : name;
          return canBrowseFolder(request.user!, subPath);
        });

        if (validDirNames.length > 0) {
          const subPaths = validDirNames.map(name => folder ? `${folder}/${name}` : name);
          const coverMap = new Map<string, { id: string, blurhash: string | null, bounding_box: any, img_width: number | null, img_height: number | null }>();

          // Batch query all custom / pre-calculated covers
          try {
            const coversRes = await query(`
              SELECT fs.folder_path, m.id, m.blurhash,
                COALESCE(m.img_width, (m.exif_json->>'width')::int) AS img_width,
                COALESCE(m.img_height, (m.exif_json->>'height')::int) AS img_height,
                (SELECT bounding_box FROM face_embeddings WHERE media_id = m.id ORDER BY created_at DESC LIMIT 1) as bounding_box
              FROM folder_settings fs
              JOIN media_files m ON m.id = COALESCE(fs.cover_media_id, fs.auto_cover_media_id)
              WHERE fs.folder_path = ANY($1::text[])
            `, [subPaths]);

            for (const row of coversRes.rows) {
              coverMap.set(row.folder_path, {
                id: row.id,
                blurhash: row.blurhash,
                bounding_box: row.bounding_box,
                img_width: row.img_width,
                img_height: row.img_height
              });
            }
          } catch (batchErr: any) {
            logger.error('Failed to batch query folder covers', batchErr);
          }

          // Batch query fallback covers for subfolders missing covers
          const missingSubPaths = subPaths.filter(sp => !coverMap.has(sp));
          if (missingSubPaths.length > 0) {
            try {
              const fallbackRes = await query(`
                SELECT sub.p AS folder_path, c.id, c.blurhash, c.img_width, c.img_height, c.bounding_box
                FROM unnest($1::text[]) AS sub(p)
                CROSS JOIN LATERAL (
                  SELECT m.id, m.blurhash,
                    COALESCE(m.img_width, (m.exif_json->>'width')::int) AS img_width,
                    COALESCE(m.img_height, (m.exif_json->>'height')::int) AS img_height,
                    (SELECT bounding_box FROM face_embeddings WHERE media_id = m.id ORDER BY created_at DESC LIMIT 1) as bounding_box
                  FROM media_files m
                  WHERE m.folder_path = sub.p OR m.folder_path LIKE sub.p || '/%'
                  ORDER BY (m.blurhash IS NOT NULL) DESC, m.id ASC
                  LIMIT 1
                ) c
              `, [missingSubPaths]);

              for (const row of fallbackRes.rows) {
                coverMap.set(row.folder_path, {
                  id: row.id,
                  blurhash: row.blurhash,
                  bounding_box: row.bounding_box,
                  img_width: row.img_width,
                  img_height: row.img_height
                });
                query(`
                  INSERT INTO folder_settings (folder_path, auto_cover_media_id)
                  VALUES ($1, $2)
                  ON CONFLICT (folder_path) DO UPDATE SET auto_cover_media_id = EXCLUDED.auto_cover_media_id
                `, [row.folder_path, row.id]).catch(() => {});
              }
            } catch (fallbackErr: any) {
              logger.error('Failed to batch query fallback covers', fallbackErr);
            }
          }

          directories = validDirNames.map(name => {
            const subPath = folder ? `${folder}/${name}` : name;
            const cover = coverMap.get(subPath);
            return {
              name,
              cover_id: cover?.id || null,
              blurhash: cover?.blurhash || null,
              cover_bounding_box: cover?.bounding_box || null,
              cover_img_width: cover?.img_width || null,
              cover_img_height: cover?.img_height || null
            };
          });
          directories.sort((a, b) => a.name.localeCompare(b.name));

          await redis.set(cacheKey, JSON.stringify(directories), 'EX', 300).catch(() => {});
        } else {
          directories = [];
          await redis.set(cacheKey, JSON.stringify([]), 'EX', 300).catch(() => {});
        }
      }
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
        console.error('Failed to resolve directories for:', folder, e);
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
    if (folder !== null && folder !== undefined) {
      const currentFolderSettingsRes = await query(`
        SELECT cover_media_id, auto_cover_media_id, description 
        FROM folder_settings WHERE folder_path = $1
      `, [folder]);
      if (currentFolderSettingsRes.rows.length > 0) {
        folderCoverId = currentFolderSettingsRes.rows[0].cover_media_id || currentFolderSettingsRes.rows[0].auto_cover_media_id || null;
        folderDescription = currentFolderSettingsRes.rows[0].description || '';
      }
    }
    mark('4_folder_settings');

    if (!folderCoverId && folder) {
      // Find cover for current folder quickly in a single query
      try {
        const fallbackResult = await query(`
          SELECT m.id, m.blurhash,
            COALESCE(m.img_width, (m.exif_json->>'width')::int) AS img_width,
            COALESCE(m.img_height, (m.exif_json->>'height')::int) AS img_height,
            (SELECT bounding_box FROM face_embeddings WHERE media_id = m.id ORDER BY created_at DESC LIMIT 1) as bounding_box
          FROM media_files m 
          WHERE m.folder_path = $1 OR m.folder_path LIKE $1 || '/%'
          ORDER BY (m.blurhash IS NOT NULL) DESC, m.id ASC
          LIMIT 1
        `, [folder]);

        if (fallbackResult.rows.length > 0) {
          folderCoverId = fallbackResult.rows[0].id;
          folderCoverBoundingBox = fallbackResult.rows[0].bounding_box;
          folderCoverImgWidth = fallbackResult.rows[0].img_width;
          folderCoverImgHeight = fallbackResult.rows[0].img_height;

          await query(`
            INSERT INTO folder_settings (folder_path, auto_cover_media_id)
            VALUES ($1, $2)
            ON CONFLICT (folder_path) DO UPDATE SET auto_cover_media_id = EXCLUDED.auto_cover_media_id
          `, [folder, folderCoverId]).catch(() => {});
        }
      } catch (err: any) {
        logger.error('Failed to find cover for folder', err);
      }
    }

    // Look up bounding box + dims for the cover image if not already resolved
    if (folderCoverId && (!folderCoverBoundingBox || !folderCoverImgWidth)) {
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
        if (!folderCoverBoundingBox) folderCoverBoundingBox = bbRes.rows[0].bounding_box;
        if (!folderCoverImgWidth) folderCoverImgWidth = bbRes.rows[0].img_width;
        if (!folderCoverImgHeight) folderCoverImgHeight = bbRes.rows[0].img_height;
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

    const escapedFolderForProc = (folder || '').replace(/([%_\\])/g, '\\$1');
    const processingRes = await query(`
      SELECT 1 
      FROM media_files 
      WHERE (folder_path = $1 OR folder_path LIKE $2 ESCAPE '\\') 
        AND (exif_json IS NULL OR blurhash IS NULL)
        AND processing_error IS NULL
        AND created_at > NOW() - INTERVAL '2 hours'
      LIMIT 1
    `, [folder || '', `${escapedFolderForProc}/%`]);
    const isProcessing = processingRes.rows.length > 0;
    mark('6_processing_count');
    mark('total');

    return reply.send({
      folder,
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
