import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../../config/db';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { AnalyticsService } from '../analytics/analytics.service';
import sharp from 'sharp';

const MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(process.cwd(), 'media');

import { requireAuth, hasFolderAccess } from '../../utils/auth';

export async function sharesRoutes(fastify: FastifyInstance) {
  fastify.post('/api/shares', { preHandler: requireAuth }, async (request, reply) => {
    const { folderPath, mediaId, personId, allowDownloadImages, allowDownloadFolder, watermarkEnabled, expiresAt } = request.body as any;
    
    // Check permissions
    if (request.user?.role === 'viewer') {
      return reply.status(403).send({ error: 'Forbidden: Viewers cannot create shares' });
    }
    
    let targetFolder = folderPath;
    if (!targetFolder && mediaId) {
      const mediaRes = await query(`SELECT folder_path FROM media_files WHERE id = $1`, [mediaId]);
      if (mediaRes.rows.length > 0) {
        targetFolder = mediaRes.rows[0].folder_path;
      }
    }

    if (targetFolder && !hasFolderAccess(request.user!, targetFolder)) {
      return reply.status(403).send({ error: 'Forbidden: You do not have access to this folder or media' });
    }
    
    const shareToken = crypto.randomBytes(16).toString('hex');
    
    await query(`
      INSERT INTO shared_folders (folder_path, media_id, person_id, share_token, allow_download_images, allow_download_folder, watermark_enabled, expires_at, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [folderPath || null, mediaId || null, personId || null, shareToken, allowDownloadImages ?? false, allowDownloadFolder ?? false, watermarkEnabled ?? false, expiresAt || null, request.user!.id]);
    
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
      return reply.send({ share, files: fileRes.rows, folderCoverId: null, defaultShareViewMode: 'small-fit', defaultShareSortMode: 'newest', defaultShareFolderViewMode: 'small-grid' });
    }

    // Person-scoped share: return all media for this person
    if (share.person_id) {
      if (subPath) return reply.status(404).send({ error: 'Not a folder share' });
      const fileRes = await query(`
        SELECT m.*, f.bounding_box, fs.cover_media_id AS folder_cover_id
        FROM media_files m
        JOIN face_embeddings f ON m.id = f.media_id
        LEFT JOIN folder_settings fs ON fs.folder_path = m.folder_path
        WHERE f.person_id = $1
        ORDER BY m.created_at DESC
      `, [share.person_id]);
      // Get person info with cover
      const personRes = await query(`SELECT id, name, cover_media_id FROM people WHERE id = $1`, [share.person_id]);
      const person = personRes.rows[0] || null;
      let personCoverBoundingBox: any = null;
      let personCoverImgWidth: number | null = null;
      let personCoverImgHeight: number | null = null;
      // Determine cover media ID (explicit cover or dynamic fallback: fewest other faces)
      let personCoverMediaId = person?.cover_media_id || null;
      if (!personCoverMediaId) {
        const coverRes = await query(`
          SELECT m.id, (
            SELECT bounding_box FROM face_embeddings
            WHERE media_id = m.id AND person_id = $1
            ORDER BY created_at DESC LIMIT 1
          ) AS bounding_box,
          COALESCE(m.img_width, (m.exif_json->>'width')::int) AS img_width,
          COALESCE(m.img_height, (m.exif_json->>'height')::int) AS img_height
          FROM media_files m
          WHERE EXISTS (SELECT 1 FROM face_embeddings WHERE media_id = m.id AND person_id = $1)
          AND m.mime_type LIKE 'image/%'
          ORDER BY CASE WHEN m.exif_json IS NOT NULL AND m.exif_json->>'width' IS NOT NULL THEN 0 ELSE 1 END,
            (SELECT COUNT(*) FROM face_embeddings WHERE media_id = m.id) ASC,
            m.created_at DESC
          LIMIT 1
        `, [share.person_id]);
        if (coverRes.rows.length > 0) {
          personCoverMediaId = coverRes.rows[0].id;
          personCoverBoundingBox = coverRes.rows[0].bounding_box;
          personCoverImgWidth = coverRes.rows[0].img_width;
          personCoverImgHeight = coverRes.rows[0].img_height;
        }
      } else {
        // Fetch bounding box + dims for explicit cover
        const explicitRes = await query(`
          SELECT (
            SELECT bounding_box FROM face_embeddings
            WHERE media_id = m.id AND person_id = $1
            ORDER BY created_at DESC LIMIT 1
          ) AS bounding_box,
          COALESCE(m.img_width, (m.exif_json->>'width')::int) AS img_width,
          COALESCE(m.img_height, (m.exif_json->>'height')::int) AS img_height
          FROM media_files m WHERE m.id = $2
        `, [share.person_id, personCoverMediaId]);
        if (explicitRes.rows.length > 0) {
          personCoverBoundingBox = explicitRes.rows[0].bounding_box;
          personCoverImgWidth = explicitRes.rows[0].img_width;
          personCoverImgHeight = explicitRes.rows[0].img_height;
        }
      }
      // Fallback: read dimensions from file if EXIF is null
      if (personCoverMediaId && (!personCoverImgWidth || !personCoverImgHeight)) {
        try {
          const fileRow = await query('SELECT folder_path, file_name FROM media_files WHERE id = $1', [personCoverMediaId]);
          if (fileRow.rows.length > 0) {
            const filePath = path.join(MEDIA_ROOT, fileRow.rows[0].folder_path || '', fileRow.rows[0].file_name);
            const meta = await sharp(filePath).metadata();
            if (meta.width) personCoverImgWidth = meta.width;
            if (meta.height) personCoverImgHeight = meta.height;
          }
        } catch (e) {
          // non-critical, fallback positioning will be used
        }
      }
      return reply.send({ share, files: fileRes.rows, person, personCoverMediaId, personCoverBoundingBox, personCoverImgWidth, personCoverImgHeight, defaultShareViewMode: 'small-fit', defaultShareSortMode: 'newest', defaultShareFolderViewMode: 'small-grid' });
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

    AnalyticsService.logView(share.media_id || '', 'view_shared_link', 0, token);

    const shareDefaultsRes = await query("SELECT key, value FROM admin_settings WHERE key = ANY($1)", [
      ['default_share_view_mode', 'default_share_sort_mode', 'default_share_folder_view_mode']
    ]);
    const shareDefaults: Record<string, string> = {
      defaultShareViewMode: 'small-fit',
      defaultShareSortMode: 'newest',
      defaultShareFolderViewMode: 'small-grid'
    };
    for (const r of shareDefaultsRes.rows) {
      if (r.key === 'default_share_view_mode') shareDefaults.defaultShareViewMode = r.value;
      if (r.key === 'default_share_sort_mode') shareDefaults.defaultShareSortMode = r.value;
      if (r.key === 'default_share_folder_view_mode') shareDefaults.defaultShareFolderViewMode = r.value;
    }

    return reply.send({ share, files: filesResult.rows, directories, folderCoverId, folderDescription, folderPath: targetPath, baseFolderPath, defaultShareViewMode: shareDefaults.defaultShareViewMode, defaultShareSortMode: shareDefaults.defaultShareSortMode, defaultShareFolderViewMode: shareDefaults.defaultShareFolderViewMode });
  }

  fastify.get<{ Params: { token: string } }>('/api/shares/:token', handleShareGet);
  fastify.get<{ Params: { token: string, '*': string } }>('/api/shares/:token/*', handleShareGet);

  fastify.get<{ Params: { '*': string } }>('/api/shares/folder/*', { preHandler: requireAuth }, async (request, reply) => {
    const folderPath = decodeURIComponent(request.params['*'] || '');
    
    if (!hasFolderAccess(request.user!, folderPath)) {
      return reply.status(403).send({ error: 'Forbidden: You do not have access to this folder' });
    }
    
    const isAdmin = request.user?.role === 'admin' || request.user?.role === 'super_admin';

    // Generate all parent paths + current path
    const parts = folderPath.split('/').filter(p => p);
    const pathsToCheck = ['']; // root
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      pathsToCheck.push(current);
    }

    const result = await query(`
      SELECT s.id, s.share_token, s.allow_download_images, s.allow_download_folder, s.watermark_enabled, s.expires_at, s.created_at,
             u.name as created_by_name, s.created_by, s.folder_path
      FROM shared_folders s
      LEFT JOIN users u ON s.created_by = u.id
      WHERE s.folder_path = ANY($1::text[])
      ORDER BY (s.folder_path = $2) DESC, s.created_at DESC
    `, [pathsToCheck, folderPath]);

    const shares = result.rows.map(row => {
      if (!isAdmin && row.created_by !== request.user!.id) {
        return {
          ...row,
          share_token: row.share_token.substring(0, 8) + '***',
          can_manage: false
        };
      }
      return {
        ...row,
        can_manage: true
      };
    });
    
    return reply.send({ shares });
  });

  // List active shares for a person
  fastify.get<{ Params: { id: string } }>('/api/shares/person/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    const isAdmin = request.user?.role === 'admin' || request.user?.role === 'super_admin';

    const result = await query(`
      SELECT s.id, s.share_token, s.allow_download_images, s.allow_download_folder, s.watermark_enabled, s.expires_at, s.created_at,
             u.name as created_by_name, s.created_by, s.person_id
      FROM shared_folders s
      LEFT JOIN users u ON s.created_by = u.id
      WHERE s.person_id = $1
      ORDER BY s.created_at DESC
    `, [id]);

    const shares = result.rows.map(row => {
      if (!isAdmin && row.created_by !== request.user!.id) {
        return { ...row, share_token: row.share_token.substring(0, 8) + '***', can_manage: false };
      }
      return { ...row, can_manage: true };
    });

    return reply.send({ shares });
  });

  fastify.delete<{ Params: { token: string } }>('/api/shares/:token', { preHandler: requireAuth }, async (request, reply) => {
    const { token } = request.params;
    
    if (request.user?.role === 'viewer') {
      return reply.status(403).send({ error: 'Forbidden: Viewers cannot delete shares' });
    }

    // Must check if user owns the folder of the share
    const shareResult = await query(`SELECT folder_path, created_by FROM shared_folders WHERE share_token = $1`, [token]);
    if (shareResult.rows.length === 0) {
      return reply.status(404).send({ error: 'Share not found' });
    }
    
    const share = shareResult.rows[0];
    if (share.folder_path && !hasFolderAccess(request.user!, share.folder_path)) {
      return reply.status(403).send({ error: 'Forbidden: You do not have access to this folder' });
    }

    const isAdmin = request.user?.role === 'admin' || request.user?.role === 'super_admin';
    if (!isAdmin && share.created_by !== request.user!.id) {
      return reply.status(403).send({ error: 'Forbidden: You can only delete your own share links' });
    }
    
    await query(`DELETE FROM shared_folders WHERE share_token = $1`, [token]);
    
    return reply.send({ success: true });
  });
}
