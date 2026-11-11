import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../../config/db';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { AnalyticsService } from '../analytics/analytics.service';
import sharp from 'sharp';
import { metadataQueue } from '../../queue/metadataQueue';
import { thumbnailQueue } from '../../queue/thumbnailQueue';
import { videoQueue } from '../../queue/videoQueue';

const MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(process.cwd(), 'media');
const defaultCacheDir = fs.existsSync('/app/cache') ? '/app/cache' : path.resolve(process.cwd(), '../volumes/cache_rw');
const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || defaultCacheDir);

import { requireAuth, hasFolderAccess } from '../../utils/auth';
import { getClientIp } from '../../utils/getIp';
import { sendPlainTextEmail } from '../../utils/mailer';

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
    
    const shareToken = crypto.randomBytes(6).toString('base64url');
    
    await query(`
      INSERT INTO shared_folders (folder_path, media_id, person_id, share_token, allow_download_images, allow_download_folder, watermark_enabled, expires_at, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [folderPath || null, mediaId || null, personId || null, shareToken, allowDownloadImages ?? false, allowDownloadFolder ?? false, watermarkEnabled ?? false, expiresAt || null, request.user!.id]);
    
    // Automatically prioritize processing for all unprocessed items in the shared folder
    if (folderPath) {
      setImmediate(async () => {
        try {
          const files = await query(`
            SELECT id, file_name, mime_type, folder_path 
            FROM media_files 
            WHERE folder_path = $1 AND (has_480p = false OR has_1080p = false)
          `, [folderPath]);
          
          for (const f of files.rows) {
            const fullPath = path.join(MEDIA_ROOT, f.folder_path, f.file_name);
            if (f.mime_type.startsWith('video/')) {
              await videoQueue.add('process-video', { mediaId: f.id, fullPath, mimeType: f.mime_type, skipCascade: true }, { priority: 1 }).catch(() => {});
            } else if (f.mime_type.startsWith('image/')) {
              await thumbnailQueue.add('generate-thumbnail', { mediaId: f.id, fullPath, mimeType: f.mime_type, skipCascade: true }, { priority: 1 }).catch(() => {});
            }
          }
        } catch (err) {
          console.error('[Shares] Failed to prioritize folder processing:', err);
        }
      });
    }

    return reply.send({ shareToken });
  });

  fastify.post('/api/shares/:token/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const { token } = request.params as any;
    const { 'cf-turnstile-response': turnstileToken } = request.body as any;

    if (!process.env.TURNSTILE_SECRET) {
      return reply.send({ success: true });
    }
    
    if (!turnstileToken) {
      AnalyticsService.logVisit({
        actionType: 'blocked_turnstile',
        shareToken: token,
        ip: getClientIp(request),
        userAgent: request.headers['user-agent'] as string | undefined,
        path: request.url,
        metadata: { reason: 'missing_token' }
      });
      return reply.status(400).send({ error: 'Security verification missing' });
    }

    const ip = getClientIp(request);
    
    try {
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: process.env.TURNSTILE_SECRET,
          response: turnstileToken,
          remoteip: ip,
        }),
      });
      if (!r.ok) throw new Error(`siteverify ${r.status}`);
      const result = await r.json();
      if (!result.success) {
        AnalyticsService.logVisit({
          actionType: 'blocked_turnstile',
          shareToken: token,
          ip,
          userAgent: request.headers['user-agent'] as string | undefined,
          path: request.url,
          metadata: { reason: 'verification_failed', errorCodes: result['error-codes'] }
        });
        return reply.status(403).send({ error: 'Security verification failed' });
      }
      
      const APP_DOMAIN = process.env.APP_DOMAIN || '';
      let cookieDomain = undefined;
      if (APP_DOMAIN) {
        try {
          const hn = new URL(APP_DOMAIN).hostname;
          if (hn !== 'localhost' && hn !== '127.0.0.1') {
            cookieDomain = hn;
          }
        } catch(e){}
      }
      
      reply.setCookie(`ts_${token}`, '1', {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        domain: cookieDomain,
        maxAge: 3600 // 1 hour
      });

      return reply.send({ success: true });
    } catch (err) {
      return reply.status(403).send({ error: 'Security verification error' });
    }
  });

  async function handleShareGet(request: any, reply: any) {
    const { token } = request.params;
    let subPath = request.params['*'] ? decodeURIComponent(request.params['*']) : '';

    if (subPath.includes('..')) return reply.status(400).send({ error: 'Invalid path' });
    
    const result = await query(`
      SELECT * FROM shared_folders 
      WHERE share_token = $1
    `, [token]);
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Share not found' });
    }

    const share = result.rows[0];
    const isExpired = Boolean(share.expires_at && new Date(share.expires_at) <= new Date());
    const isDisabled = share.is_active === false;

    if (isDisabled || isExpired) {
      const folderPath = share.folder_path || '';
      const folderName = folderPath ? (folderPath.split('/').pop() || folderPath) : (share.person_id ? 'Person Gallery' : 'Shared Album');
      return reply.send({
        expired: true,
        isDisabled,
        isExpired,
        folderName,
        folderPath,
        shareToken: token,
      });
    }

    const userAgent = (request.headers['user-agent'] || '').toLowerCase();
    const isSocialCrawler = /whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|linkedinbot|slackbot|discordbot|applebot|bingbot|googlebot|pinterest/i.test(userAgent);

    if (process.env.TURNSTILE_SECRET && !isSocialCrawler) {
      const tsCookie = request.cookies[`ts_${token}`];
      if (!tsCookie) {
        return reply.status(403).send({ error: 'turnstile_required' });
      }
    }
    
    // Normalize subPath: tolerate share URLs that include the share's own base folder
    // path (e.g. old/absolute-path links) by stripping the base prefix.
    if (share.folder_path && subPath && (subPath === share.folder_path || subPath.startsWith(share.folder_path + '/'))) {
      subPath = subPath === share.folder_path ? '' : subPath.slice(share.folder_path.length + 1);
    }
    
    if (share.media_id) {
      if (subPath) return reply.status(404).send({ error: 'Not a folder share' });
      const fileRes = await query(`SELECT * FROM media_files WHERE id = $1`, [share.media_id]);
      return reply.send({ share, files: fileRes.rows, folderCoverId: null, defaultShareViewMode: 'small-fit', defaultShareSortMode: 'oldest', defaultShareFolderViewMode: 'small-grid' });
    }

    // Person-scoped share: return all media for this person
    if (share.person_id) {
      if (subPath) return reply.status(404).send({ error: 'Not a folder share' });
      const fileRes = await query(`
        SELECT m.*, f.bounding_box, COALESCE(fs.cover_media_id, fs.auto_cover_media_id) AS folder_cover_id
        FROM media_files m
        JOIN face_embeddings f ON m.id = f.media_id
        LEFT JOIN folder_settings fs ON fs.folder_path = m.folder_path
        WHERE f.person_id = $1
        ORDER BY m.created_at DESC
      `, [share.person_id]);
      const files = fileRes.rows;
      
      const missingMetadata = files.filter((f: any) => f.exif_json == null);
      const missingThumbs = files.filter((f: any) => !f.has_480p || !f.has_1080p);

      Promise.all(missingMetadata.map((f: any) => 
        metadataQueue.add('extract-metadata', { 
          mediaId: f.id, 
          fullPath: path.join(MEDIA_ROOT, f.folder_path || '', f.file_name), 
          mimeType: f.mime_type 
        }, { priority: 2 })
      )).catch(err => console.error('Failed to queue metadata jobs', err));

      Promise.all(missingThumbs.map((f: any) => {
        const fPath = path.join(MEDIA_ROOT, f.folder_path || '', f.file_name);
        if (f.mime_type.startsWith('video/')) {
          return videoQueue.add('process-video', { mediaId: f.id, fullPath: fPath, mimeType: f.mime_type }, { priority: 2 });
        } else {
          return thumbnailQueue.add('generate-thumbnail', { mediaId: f.id, fullPath: fPath, mimeType: f.mime_type }, { priority: 2 });
        }
      })).catch(err => console.error('Failed to queue thumbnail jobs', err));

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
      return reply.send({ share, files: fileRes.rows, person, personCoverMediaId, personCoverBoundingBox, personCoverImgWidth, personCoverImgHeight, defaultShareViewMode: 'small-fit', defaultShareSortMode: 'oldest', defaultShareFolderViewMode: 'small-grid' });
    }
    
    let targetPath = (share.folder_path || '').replace(/\\/g, '/');
    const baseFolderPath = targetPath;
    if (subPath) {
      const cleanSub = path.normalize(subPath).replace(/^(\.\.[\/\\])+/, '');
      targetPath = targetPath ? path.join(targetPath, cleanSub).replace(/\\/g, '/') : cleanSub;
    }
    // Update share.folder_path to targetPath so the frontend sees the current folder
    share.folder_path = targetPath;

    // Fetch folder contents
    const filesResult = await query(
      `SELECT id, folder_path, file_name, mime_type, size_bytes, blurhash, exif_json, has_1080p, has_480p, is_transcoded, transcoded_mp4_path, transcoded_webm_path, created_at, updated_at, img_width, img_height FROM media_files WHERE folder_path = $1 ORDER BY file_name ASC`, 
      [targetPath]
    );
    const files = filesResult.rows;

    const missingMetadata = files.filter((f: any) => f.exif_json == null);
    const missingThumbs = files.filter((f: any) => !f.has_480p || !f.has_1080p);

    Promise.all(missingMetadata.map((f: any) => 
      metadataQueue.add('extract-metadata', { 
        mediaId: f.id, 
        fullPath: path.join(MEDIA_ROOT, f.folder_path || '', f.file_name), 
        mimeType: f.mime_type 
      }, { priority: 2 })
    )).catch(err => console.error('Failed to queue metadata jobs', err));

    Promise.all(missingThumbs.map((f: any) => {
      const fPath = path.join(MEDIA_ROOT, f.folder_path || '', f.file_name);
      if (f.mime_type.startsWith('video/')) {
        return videoQueue.add('process-video', { mediaId: f.id, fullPath: fPath, mimeType: f.mime_type }, { priority: 2 });
      } else {
        return thumbnailQueue.add('generate-thumbnail', { mediaId: f.id, fullPath: fPath, mimeType: f.mime_type }, { priority: 2 });
      }
    })).catch(err => console.error('Failed to queue thumbnail jobs', err));

    const resolvedMediaRoot = path.resolve(MEDIA_ROOT);
    const fullPath = path.resolve(resolvedMediaRoot, targetPath);
    if (!fullPath.startsWith(resolvedMediaRoot)) {
      return reply.status(400).send({ error: 'Invalid folder path' });
    }
    let directories: { name: string, cover_id: string | null, blurhash: string | null }[] = [];
    try {
      if (fs.existsSync(fullPath)) {
        const items = await fs.promises.readdir(fullPath, { withFileTypes: true });
        
        const dirNames = items.filter(item => item.isDirectory()).map(item => item.name);
        
        directories = await Promise.all(dirNames.map(async (name) => {
          const subPath = share.folder_path ? `${share.folder_path}/${name}` : name;
          
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
              cover_bounding_box: customCoverRes.rows[0].bounding_box || null,
              cover_img_width: customCoverRes.rows[0].img_width || null,
              cover_img_height: customCoverRes.rows[0].img_height || null
            };
          }

          const coverResult = await query(`
            SELECT m.id, m.blurhash,
              COALESCE(m.img_width, (m.exif_json->>'width')::int) AS img_width,
              COALESCE(m.img_height, (m.exif_json->>'height')::int) AS img_height,
              (SELECT bounding_box FROM face_embeddings WHERE media_id = m.id ORDER BY created_at DESC LIMIT 1) as bounding_box
            FROM media_files m 
            WHERE m.folder_path = $1 OR m.folder_path LIKE $1 || '/%'
            ORDER BY (m.blurhash IS NOT NULL) DESC, m.id ASC
            LIMIT 1
          `, [subPath]);
          
          if (coverResult.rows.length > 0) {
            query(`
              INSERT INTO folder_settings (folder_path, auto_cover_media_id)
              VALUES ($1, $2)
              ON CONFLICT (folder_path) DO UPDATE SET auto_cover_media_id = EXCLUDED.auto_cover_media_id
            `, [subPath, coverResult.rows[0].id]).catch(() => {});
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
      }
    } catch (e) {
      console.error('Failed to read directory:', fullPath, e);
    }

    let folderCoverId = null;
    let folderCoverBoundingBox: any = null;
    let folderCoverImgWidth: number | null = null;
    let folderCoverImgHeight: number | null = null;
    let folderDescription = '';
    
    if (targetPath !== null && targetPath !== undefined) {
      const currentFolderSettingsRes = await query(`
        SELECT cover_media_id, auto_cover_media_id, description 
        FROM folder_settings WHERE folder_path = $1
      `, [targetPath]);
      if (currentFolderSettingsRes.rows.length > 0) {
        folderCoverId = currentFolderSettingsRes.rows[0].cover_media_id || currentFolderSettingsRes.rows[0].auto_cover_media_id || null;
        folderDescription = currentFolderSettingsRes.rows[0].description || '';
      }
    }

    if (!folderCoverId && targetPath) {
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
        `, [targetPath]);
        
        if (fallbackResult.rows.length > 0) {
          folderCoverId = fallbackResult.rows[0].id;
          folderCoverBoundingBox = fallbackResult.rows[0].bounding_box;
          folderCoverImgWidth = fallbackResult.rows[0].img_width;
          folderCoverImgHeight = fallbackResult.rows[0].img_height;

          await query(`
            INSERT INTO folder_settings (folder_path, auto_cover_media_id)
            VALUES ($1, $2)
            ON CONFLICT (folder_path) DO UPDATE SET auto_cover_media_id = EXCLUDED.auto_cover_media_id
          `, [targetPath, folderCoverId]).catch(() => {});
        }
      } catch (err: any) {
        console.error('Failed to find cover for share folder', err);
      }
    }

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

    AnalyticsService.logView(share.media_id || '', 'view_shared_link', 0, token);
    AnalyticsService.logVisit({
      mediaId: share.media_id || null,
      shareToken: token,
      deviceId: (request as any).deviceId || (request.cookies as any)?.['hmp_device_id'] || null,
      folderPath: targetPath || share.folder_path || null,
      actionType: 'view_shared_link',
      ip: getClientIp(request),
      userAgent: request.headers['user-agent'] as string | undefined,
      referrer: request.headers.referer as string | undefined,
      path: request.url
    });

    const shareDefaultsRes = await query("SELECT key, value FROM admin_settings WHERE key = ANY($1)", [
      ['default_share_view_mode', 'default_share_sort_mode', 'default_share_folder_view_mode']
    ]);
    const shareDefaults: Record<string, string> = {
      defaultShareViewMode: 'small-fit',
      defaultShareSortMode: 'oldest',
      defaultShareFolderViewMode: 'small-grid'
    };
    for (const r of shareDefaultsRes.rows) {
      if (r.key === 'default_share_view_mode') shareDefaults.defaultShareViewMode = r.value;
      if (r.key === 'default_share_sort_mode') shareDefaults.defaultShareSortMode = r.value;
      if (r.key === 'default_share_folder_view_mode') shareDefaults.defaultShareFolderViewMode = r.value;
    }

    return reply.send({
      share,
      files: filesResult.rows,
      directories,
      folderCoverId,
      folderCoverBoundingBox,
      folderCoverImgWidth,
      folderCoverImgHeight,
      folderDescription,
      folderPath: targetPath,
      baseFolderPath,
      defaultShareViewMode: shareDefaults.defaultShareViewMode,
      defaultShareSortMode: shareDefaults.defaultShareSortMode,
      defaultShareFolderViewMode: shareDefaults.defaultShareFolderViewMode
    });
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
             s.is_active,
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
             s.is_active,
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

  fastify.patch<{ Params: { token: string } }>('/api/shares/:token', { preHandler: requireAuth }, async (request, reply) => {
    const { token } = request.params;
    const { 
      isActive, 
      expiresAt, 
      allowDownloadImages, 
      allowDownloadFolder, 
      watermarkEnabled 
    } = request.body as { 
      isActive?: boolean; 
      expiresAt?: string | null;
      allowDownloadImages?: boolean;
      allowDownloadFolder?: boolean;
      watermarkEnabled?: boolean;
    };

    if (request.user?.role === 'viewer') {
      return reply.status(403).send({ error: 'Forbidden: Viewers cannot modify shares' });
    }

    const shareResult = await query(`SELECT folder_path, created_by, is_active, expires_at FROM shared_folders WHERE share_token = $1`, [token]);
    if (shareResult.rows.length === 0) {
      return reply.status(404).send({ error: 'Share not found' });
    }

    const share = shareResult.rows[0];
    if (share.folder_path && !hasFolderAccess(request.user!, share.folder_path)) {
      return reply.status(403).send({ error: 'Forbidden: You do not have access to this folder' });
    }

    const isAdmin = request.user?.role === 'admin' || request.user?.role === 'super_admin';
    if (!isAdmin && share.created_by !== request.user!.id) {
      return reply.status(403).send({ error: 'Forbidden: You can only modify your own share links' });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (typeof isActive === 'boolean') {
      updates.push(`is_active = $${idx++}`);
      values.push(isActive);
    }

    if (expiresAt !== undefined) {
      updates.push(`expires_at = $${idx++}`);
      values.push(expiresAt);
    }

    if (typeof allowDownloadImages === 'boolean') {
      updates.push(`allow_download_images = $${idx++}`);
      values.push(allowDownloadImages);
    }

    if (typeof allowDownloadFolder === 'boolean') {
      updates.push(`allow_download_folder = $${idx++}`);
      values.push(allowDownloadFolder);
    }

    if (typeof watermarkEnabled === 'boolean') {
      updates.push(`watermark_enabled = $${idx++}`);
      values.push(watermarkEnabled);
    }

    if (updates.length === 0) {
      return reply.send({ success: true, share });
    }

    values.push(token);
    const updateRes = await query(`
      UPDATE shared_folders 
      SET ${updates.join(', ')} 
      WHERE share_token = $${idx}
      RETURNING *
    `, values);

    return reply.send({ success: true, share: updateRes.rows[0] });
  });

  // Public endpoint: submit an access request for an expired or disabled link
  fastify.post<{ Params: { token: string } }>('/api/shares/:token/request-access', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const { token } = request.params;
    const { name, email, note } = (request.body || {}) as { name?: string; email?: string; note?: string };
    const turnstileToken = (request.body as any)?.['cf-turnstile-response'] || (request.body as any)?.turnstileToken;

    if (process.env.TURNSTILE_SECRET) {
      if (!turnstileToken) {
        AnalyticsService.logVisit({
          actionType: 'blocked_turnstile',
          shareToken: token,
          ip: getClientIp(request),
          userAgent: request.headers['user-agent'] as string | undefined,
          path: request.url,
          metadata: { context: 'request_access', reason: 'missing_token' }
        });
        return reply.status(400).send({ error: 'Please complete the security check.' });
      }

      const ip = getClientIp(request);
      try {
        const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            secret: process.env.TURNSTILE_SECRET,
            response: turnstileToken,
            remoteip: ip,
          }),
        });
        if (!r.ok) throw new Error(`siteverify ${r.status}`);
        const result = await r.json();
        if (!result.success) {
          AnalyticsService.logVisit({
            actionType: 'blocked_turnstile',
            shareToken: token,
            ip,
            userAgent: request.headers['user-agent'] as string | undefined,
            path: request.url,
            metadata: { context: 'request_access', reason: 'verification_failed', errorCodes: result['error-codes'] }
          });
          return reply.status(403).send({ error: 'Security verification failed. Please try again.' });
        }
      } catch (err: any) {
        AnalyticsService.logVisit({
          actionType: 'blocked_turnstile',
          shareToken: token,
          ip,
          userAgent: request.headers['user-agent'] as string | undefined,
          path: request.url,
          metadata: { context: 'request_access', reason: 'siteverify_error', message: err.message }
        });
        return reply.status(403).send({ error: 'Security verification failed. Please try again.' });
      }
    }

    const shareResult = await query(`SELECT folder_path, created_by FROM shared_folders WHERE share_token = $1`, [token]);
    if (shareResult.rows.length === 0) {
      return reply.status(404).send({ error: 'Share link not found' });
    }

    const share = shareResult.rows[0];
    const folderPath = share.folder_path || '';
    const folderName = folderPath ? (folderPath.split('/').pop() || folderPath) : 'Shared Album';

    await query(`
      INSERT INTO share_access_requests (share_token, folder_path, name, email, note, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
    `, [token, folderPath, name?.trim() || null, email?.trim() || null, note?.trim() || null]);

    // Send email notification to admin / creator
    const APP_DOMAIN = process.env.PUBLIC_APP_DOMAIN || process.env.APP_DOMAIN || 'http://localhost:8000';
    const recipients = new Set<string>();

    if (process.env.ADMIN_EMAIL) {
      recipients.add(process.env.ADMIN_EMAIL.trim());
    }

    if (share.created_by) {
      const creatorRes = await query(`SELECT email FROM users WHERE id = $1`, [share.created_by]);
      if (creatorRes.rows.length > 0 && creatorRes.rows[0].email) {
        recipients.add(creatorRes.rows[0].email.trim());
      }
    }

    const adminsRes = await query(`SELECT email FROM users WHERE role IN ('admin', 'super_admin')`);
    for (const row of adminsRes.rows) {
      if (row.email) recipients.add(row.email.trim());
    }

    const requesterName = name?.trim();
    const subject = requesterName
      ? `Access Request from ${requesterName} for folder: ${folderName}`
      : `Access Request for folder: ${folderName}`;

    const plainText = [
      `${requesterName || 'Someone'} has requested access to the shared folder "${folderName}".`,
      ``,
      `Folder Path: ${folderPath || '/'}`,
      `Share Link: ${APP_DOMAIN}/share/${token}`,
      ``,
      `Requester Details:`,
      `- Name: ${name?.trim() || 'Not provided'}`,
      `- Email: ${email?.trim() || 'Not provided'}`,
      `- Note: ${note?.trim() || 'No note provided'}`,
      ``,
      `You can review and manage access requests here:`,
      `${APP_DOMAIN}/folder/${encodeURIComponent(folderPath)}`
    ].join('\n');

    for (const to of recipients) {
      sendPlainTextEmail({
        to,
        subject,
        text: plainText,
      }).catch(err => console.error('[Shares] Failed to send access request email:', err));
    }

    return reply.send({ success: true, message: 'Access request submitted successfully' });
  });

  // Authenticated endpoint: view all access requests for a folder
  fastify.get<{ Params: { '*': string } }>('/api/shares/folder-requests/*', { preHandler: requireAuth }, async (request, reply) => {
    const folderPath = decodeURIComponent(request.params['*'] || '');

    if (!hasFolderAccess(request.user!, folderPath)) {
      return reply.status(403).send({ error: 'Forbidden: You do not have access to this folder' });
    }

    const parts = folderPath.split('/').filter(p => p);
    const pathsToCheck = [''];
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      pathsToCheck.push(current);
    }

    const result = await query(`
      SELECT r.id, r.share_token, r.folder_path, r.name, r.email, r.note, r.status, r.created_at,
             s.is_active, s.expires_at
      FROM share_access_requests r
      LEFT JOIN shared_folders s ON r.share_token = s.share_token
      WHERE r.folder_path = ANY($1::text[])
      ORDER BY r.created_at DESC
    `, [pathsToCheck]);

    return reply.send({ requests: result.rows });
  });

  // Authenticated endpoint: respond to an access request
  fastify.post<{ Params: { id: string } }>('/api/shares/requests/:id/respond', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    const { action, expiresAt, notifyUser } = request.body as {
      action: 'extend' | 'reactivate' | 'new_link';
      expiresAt?: string | null;
      notifyUser?: boolean;
    };

    if (request.user?.role === 'viewer') {
      return reply.status(403).send({ error: 'Forbidden: Viewers cannot respond to requests' });
    }

    const reqResult = await query(`
      SELECT r.*, s.created_by, s.folder_path as share_folder_path
      FROM share_access_requests r
      LEFT JOIN shared_folders s ON r.share_token = s.share_token
      WHERE r.id = $1
    `, [id]);

    if (reqResult.rows.length === 0) {
      return reply.status(404).send({ error: 'Access request not found' });
    }

    const reqRow = reqResult.rows[0];
    const targetFolderPath = reqRow.folder_path || reqRow.share_folder_path || '';

    if (targetFolderPath && !hasFolderAccess(request.user!, targetFolderPath)) {
      return reply.status(403).send({ error: 'Forbidden: You do not have access to this folder' });
    }

    let finalToken = reqRow.share_token;

    if (action === 'extend') {
      await query(`
        UPDATE shared_folders 
        SET expires_at = $1, is_active = true 
        WHERE share_token = $2
      `, [expiresAt || null, reqRow.share_token]);
    } else if (action === 'reactivate') {
      await query(`
        UPDATE shared_folders 
        SET is_active = true 
        WHERE share_token = $1
      `, [reqRow.share_token]);
    } else if (action === 'new_link') {
      finalToken = crypto.randomBytes(6).toString('base64url');
      await query(`
        INSERT INTO shared_folders (folder_path, share_token, expires_at, created_by, is_active)
        VALUES ($1, $2, $3, $4, true)
      `, [targetFolderPath, finalToken, expiresAt || null, request.user!.id]);
    }

    await query(`
      UPDATE share_access_requests 
      SET status = 'resolved', updated_at = NOW() 
      WHERE id = $1
    `, [id]);

    const APP_DOMAIN = process.env.PUBLIC_APP_DOMAIN || process.env.APP_DOMAIN || 'http://localhost:8000';
    const folderName = targetFolderPath ? (targetFolderPath.split('/').pop() || targetFolderPath) : 'Shared Folder';
    const linkUrl = `${APP_DOMAIN}/share/${finalToken}`;

    if (notifyUser && reqRow.email) {
      const emailText = [
        `Hello ${reqRow.name ? reqRow.name.trim() : 'there'},`,
        ``,
        `Your request for access to the folder "${folderName}" has been approved.`,
        ``,
        `You can access the shared folder using the link below:`,
        linkUrl,
        ``,
        `Thank you!`
      ].join('\n');

      sendPlainTextEmail({
        to: reqRow.email.trim(),
        subject: reqRow.name?.trim() ? `Access Approved for ${reqRow.name.trim()}: ${folderName}` : `Access Approved: ${folderName}`,
        text: emailText,
      }).catch(err => console.error('[Shares] Failed to send approval email to user:', err));
    }

    return reply.send({ success: true, shareToken: finalToken });
  });

  fastify.get<{ Params: { token: string }, Querystring: { path?: string } }>('/api/shares/:token/og', async (request, reply) => {
    const { token } = request.params;
    const { path: subPath } = request.query;

    const res = await query(`SELECT folder_path FROM shared_folders WHERE share_token = $1`, [token]);
    if (res.rows.length === 0) return reply.status(404).send({ error: 'Not found' });

    const baseFolderPath = res.rows[0].folder_path;
    let targetFolder = baseFolderPath;
    if (subPath) {
      const cleanSub = path.normalize(subPath).replace(/^(\.\.[\/\\])+/, '');
      targetFolder = path.join(baseFolderPath, cleanSub).replace(/\\/g, '/');
    }

    const { OgService } = await import('../media/og.service');
    try {
      // Synchronously generate and serve the OG image if requested (cached by OgService)
      const imagePath = await OgService.generateForFolder(token, targetFolder);
      const resolvedImagePath = path.resolve(imagePath);
      const allowedCache = CACHE_ROOT;
      if (!resolvedImagePath.startsWith(allowedCache)) {
        return reply.status(400).send({ error: 'Invalid image path' });
      }
      
      const stat = fs.statSync(resolvedImagePath);
      reply.header('Content-Type', 'image/png');
      reply.header('Content-Length', stat.size);
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.send(fs.createReadStream(resolvedImagePath));
    } catch (err: any) {
      request.log.error(err);
      return reply.status(500).send({ error: 'Failed to generate OG image' });
    }
  });
}
