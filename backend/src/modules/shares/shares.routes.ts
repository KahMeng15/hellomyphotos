import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../../config/db';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { AnalyticsService } from '../analytics/analytics.service';
import sharp from 'sharp';
import { metadataQueue } from '../../queue/metadataQueue';
import { thumbnailQueue } from '../../queue/thumbnailQueue';
import { videoQueue } from '../../queue/videoQueue';
import { redis, deleteKeysByPattern } from '../../config/redis';

const MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(process.cwd(), 'media');
import { resolveMediaFullPath } from '../../utils/mediaPath';
const defaultCacheDir = fs.existsSync('/app/cache') ? '/app/cache' : path.resolve(process.cwd(), '../volumes/cache_rw');
const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || defaultCacheDir);

import { requireAuth, hasFolderAccess, invalidateShareCache, getSharePasswordSig } from '../../utils/auth';
import { getClientIp } from '../../utils/getIp';
import { sendPlainTextEmail } from '../../utils/mailer';
import { isShareLockdownActive } from '../../utils/lockdown';
import { WatermarkService } from '../media/watermark.service';
import { PERSON_COVER_ORDER_CLAUSE } from '../ml/personCover.utils';
import { FastUpService } from '../staging/fastup.service';
import { StagingService } from '../staging/staging.service';

function isSharePasswordUnlocked(share: any, token: string, request: FastifyRequest): boolean {
  if (!share.password_hash) return true;
  const expectedSig = getSharePasswordSig(token, share.password_hash);
  return request.cookies[`sp_${token}`] === expectedSig;
}

async function getShareLockoutStatus(token: string, ip: string) {
  const redisKey = `login_attempts:share:${token}:${ip}`;

  const { rows: settingsRows } = await query(`
    SELECT key, value FROM admin_settings 
    WHERE key IN ('auth_max_login_tries', 'auth_timeout_minutes', 'auth_double_timeout')
  `);
  let maxTries = 5;
  let timeoutMinutes = 15;
  let doubleTimeout = true;
  for (const r of settingsRows) {
    try {
      if (r.key === 'auth_max_login_tries') {
        const v = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
        maxTries = Number(v) || 5;
      }
      if (r.key === 'auth_timeout_minutes') {
        const v = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
        timeoutMinutes = Number(v) || 15;
      }
      if (r.key === 'auth_double_timeout') {
        const v = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
        doubleTimeout = typeof v === 'string' ? v === 'true' : Boolean(v);
      }
    } catch (e) {}
  }

  const attemptsData = await redis.get(redisKey);
  let attempts = 0;
  let currentPenalty = timeoutMinutes * 60; // in seconds
  let blockedUntil = 0;

  if (attemptsData) {
    try {
      const parsed = JSON.parse(attemptsData);
      attempts = parsed.attempts || 0;
      currentPenalty = parsed.currentPenalty || (timeoutMinutes * 60);
      blockedUntil = parsed.blockedUntil || 0;

      if (Date.now() < blockedUntil) {
        const remainingMinutes = Math.ceil((blockedUntil - Date.now()) / 60000);
        return {
          isLockedOut: true,
          remainingMinutes,
          blockedUntil,
          attempts,
          currentPenalty,
          maxTries,
          doubleTimeout,
          redisKey
        };
      }
    } catch (e) {}
  }

  return {
    isLockedOut: false,
    remainingMinutes: 0,
    blockedUntil: 0,
    attempts,
    currentPenalty,
    maxTries,
    doubleTimeout,
    redisKey
  };
}

export async function sharesRoutes(fastify: FastifyInstance) {
  fastify.post('/api/shares', { preHandler: requireAuth }, async (request, reply) => {
    const { folderPath, mediaId, personId, allowDownloadImages, allowDownloadFolder, watermarkEnabled, watermarkTemplateId, expiresAt, allowFavorites, allowFilterFavorites, password, label, createdAt } = request.body as any;
    
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
    
    const shareToken = crypto.randomBytes(16).toString('base64url');
    const isWatermarked = watermarkEnabled ?? Boolean(watermarkTemplateId);
    let passwordHash: string | null = null;
    if (password && typeof password === 'string' && password.trim()) {
      passwordHash = await bcrypt.hash(password.trim(), 10);
    }
    
    await query(`
      INSERT INTO shared_folders (folder_path, media_id, person_id, share_token, allow_download_images, allow_download_folder, watermark_enabled, watermark_template_id, expires_at, created_by, allow_favorites, allow_filter_favorites, password_hash, label, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, COALESCE($15::timestamptz, NOW()))
    `, [folderPath || null, mediaId || null, personId || null, shareToken, allowDownloadImages ?? false, allowDownloadFolder ?? false, isWatermarked, watermarkTemplateId || null, expiresAt || null, request.user!.id, allowFavorites ?? false, allowFilterFavorites ?? false, passwordHash, label ? String(label).trim() : null, createdAt || null]);
    
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
            const fullPath = resolveMediaFullPath(f.folder_path, f.file_name);
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

    if (await isShareLockdownActive()) {
      return reply.status(403).send({ error: 'All share links are temporarily disabled due to system lockdown', isLockdown: true });
    }

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

  fastify.post('/api/shares/:token/unlock', async (request: FastifyRequest, reply: FastifyReply) => {
    const { token } = request.params as any;
    const body = (request.body || {}) as any;
    const password = body.password;
    const turnstileToken = body['cf-turnstile-response'] || body.turnstileToken;

    if (await isShareLockdownActive()) {
      return reply.status(403).send({ error: 'All share links are temporarily disabled due to system lockdown', isLockdown: true });
    }

    const shareRes = await query(`SELECT * FROM shared_folders WHERE share_token = $1`, [token]);
    if (shareRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Share not found' });
    }
    const share = shareRes.rows[0];
    if (share.is_active === false) {
      return reply.status(403).send({ error: 'Share link disabled' });
    }
    if (share.expires_at && new Date(share.expires_at) <= new Date()) {
      return reply.status(401).send({ error: 'Share link expired' });
    }

    const ip = getClientIp(request);

    // Check rate limit & lockout
    const lockout = await getShareLockoutStatus(token, ip);
    if (lockout.isLockedOut) {
      AnalyticsService.logVisit({
        actionType: 'blocked_login_lockout',
        shareToken: token,
        ip,
        userAgent: request.headers['user-agent'] as string | undefined,
        path: request.url,
        metadata: { reason: 'locked_out', remainingMinutes: lockout.remainingMinutes }
      });
      return reply.status(429).send({
        error: `Too many failed attempts. Please try again in ${lockout.remainingMinutes} minute(s).`,
        isLockedOut: true,
        remainingMinutes: lockout.remainingMinutes
      });
    }

    // If Turnstile secret is set, verify turnstileToken unless a valid ts cookie already exists
    if (process.env.TURNSTILE_SECRET) {
      const tsCookie = (request.cookies as any)?.[`ts_${token}`];
      if (!tsCookie) {
        if (!turnstileToken) {
          AnalyticsService.logVisit({
            actionType: 'blocked_turnstile',
            shareToken: token,
            ip,
            userAgent: request.headers['user-agent'] as string | undefined,
            path: request.url,
            metadata: { reason: 'missing_turnstile_token_on_unlock' }
          });
          return reply.status(400).send({ error: 'Security verification missing' });
        }

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
          const result = await r.json() as { success: boolean; 'error-codes'?: string[] };
          if (!result.success) {
            AnalyticsService.logVisit({
              actionType: 'blocked_turnstile',
              shareToken: token,
              ip,
              userAgent: request.headers['user-agent'] as string | undefined,
              path: request.url,
              metadata: { reason: 'turnstile_failed_on_unlock', errorCodes: result['error-codes'] }
            });
            return reply.status(403).send({ error: 'Security verification failed' });
          }
        } catch (err) {
          return reply.status(403).send({ error: 'Security verification error' });
        }
      }
    }

    // Verify password if required
    if (share.password_hash) {
      let isValid = false;
      if (password && typeof password === 'string') {
        isValid = await bcrypt.compare(password, share.password_hash);
      }

      if (!isValid) {
        let newAttempts = (lockout.attempts || 0) + 1;
        let newBlockedUntil = 0;
        let newPenalty = lockout.currentPenalty;

        if (newAttempts >= lockout.maxTries) {
          newBlockedUntil = Date.now() + (newPenalty * 1000);
          if (lockout.doubleTimeout) {
            newPenalty = newPenalty * 2;
          }
          newAttempts = 0;
          AnalyticsService.logVisit({
            actionType: 'blocked_login_lockout',
            shareToken: token,
            ip,
            userAgent: request.headers['user-agent'] as string | undefined,
            path: request.url,
            metadata: { reason: 'max_tries_exceeded', maxTries: lockout.maxTries, penaltySeconds: newPenalty }
          });
        } else {
          AnalyticsService.logVisit({
            actionType: 'blocked_access',
            shareToken: token,
            ip,
            userAgent: request.headers['user-agent'] as string | undefined,
            path: request.url,
            metadata: { context: 'share_password_failed', attempt: newAttempts, maxTries: lockout.maxTries }
          });
        }

        await redis.set(lockout.redisKey, JSON.stringify({
          attempts: newAttempts,
          currentPenalty: newPenalty,
          blockedUntil: newBlockedUntil
        }), 'EX', 86400 * 7);

        if (newBlockedUntil > 0) {
          const remainingMinutes = Math.ceil((newBlockedUntil - Date.now()) / 60000);
          return reply.status(429).send({
            error: `Too many failed attempts. Please try again in ${remainingMinutes} minute(s).`,
            isLockedOut: true,
            remainingMinutes
          });
        }

        const remainingTries = lockout.maxTries - newAttempts;
        return reply.status(401).send({
          error: `Incorrect password. ${remainingTries} attempt${remainingTries === 1 ? '' : 's'} remaining.`
        });
      }

      // Password matches: clear failed attempts
      await redis.del(lockout.redisKey);
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

    if (share.password_hash) {
      const sig = getSharePasswordSig(token, share.password_hash);
      reply.setCookie(`sp_${token}`, sig, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        domain: cookieDomain,
        maxAge: 7 * 86400 // 7 days
      });
    }

    reply.setCookie(`ts_${token}`, '1', {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: cookieDomain,
      maxAge: 7 * 86400
    });

    AnalyticsService.logVisit({
      actionType: 'unlocked_share',
      shareToken: token,
      ip,
      userAgent: request.headers['user-agent'] as string | undefined,
      path: request.url
    });

    return reply.send({ success: true });
  });

  const handleShareExit = async (request: FastifyRequest, reply: FastifyReply) => {
    const { token } = request.params as any;
    const APP_DOMAIN = process.env.APP_DOMAIN || '';
    let cookieDomain: string | undefined = undefined;
    if (APP_DOMAIN) {
      try {
        const hn = new URL(APP_DOMAIN).hostname;
        if (hn !== 'localhost' && hn !== '127.0.0.1') {
          cookieDomain = hn;
        }
      } catch(e){}
    }
    const clearOpts = {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 0,
      expires: new Date(0)
    };
    if (cookieDomain) {
      reply.setCookie(`sp_${token}`, '', { ...clearOpts, domain: cookieDomain });
      reply.clearCookie(`sp_${token}`, { path: '/', domain: cookieDomain });
    }
    reply.setCookie(`sp_${token}`, '', clearOpts);
    reply.clearCookie(`sp_${token}`, { path: '/' });

    if (request.method === 'GET') {
      return reply.redirect(`/share/${token}`);
    }
    return reply.send({ success: true });
  };

  fastify.post('/api/shares/:token/exit', handleShareExit);
  fastify.get('/api/shares/:token/exit', handleShareExit);

  async function handleShareGet(request: any, reply: any) {
    const { token } = request.params;
    let subPath = request.params['*'] ? decodeURIComponent(request.params['*']) : '';

    if (subPath.includes('..')) return reply.status(400).send({ error: 'Invalid path' });
    
    const result = await query(`
      SELECT s.*, COALESCE(wt.updated_at, d.updated_at) as watermark_updated_at
      FROM shared_folders s
      LEFT JOIN watermark_templates wt ON s.watermark_template_id = wt.id
      LEFT JOIN LATERAL (SELECT updated_at FROM watermark_templates WHERE is_default = true LIMIT 1) d ON s.watermark_enabled = true
      WHERE s.share_token = $1
    `, [token]);
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Share not found' });
    }

    const share = result.rows[0];
    const isLockdown = await isShareLockdownActive();
    const isExpired = Boolean(share.expires_at && new Date(share.expires_at) <= new Date());
    const isDisabled = share.is_active === false || isLockdown;

    if (isLockdown || isDisabled || isExpired) {
      const folderPath = share.folder_path || '';
      const folderName = folderPath ? (folderPath.split('/').pop() || folderPath) : (share.person_id ? 'Person Gallery' : 'Shared Album');
      return reply.send({
        expired: true,
        isDisabled,
        isExpired,
        isLockdown,
        folderName,
        folderPath,
        shareToken: token,
        message: isLockdown ? 'All share links are temporarily disabled due to system lockdown.' : undefined,
      });
    }

    const userAgent = (request.headers['user-agent'] || '').toLowerCase();
    const isSocialCrawler = /whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|linkedinbot|slackbot|discordbot|applebot|bingbot|googlebot|pinterest/i.test(userAgent);

    // Password protection check
    if (share.password_hash && !isSharePasswordUnlocked(share, token, request)) {
      const folderPath = share.folder_path || '';
      const folderName = folderPath ? (folderPath.split('/').pop() || folderPath) : (share.person_id ? 'Person Gallery' : 'Shared Album');
      if (isSocialCrawler) {
        return reply.send({
          share: { id: share.id, folder_path: share.folder_path, expires_at: share.expires_at },
          files: [],
          directories: [],
          folderCoverId: null,
          folderName,
          crawlerPreview: true
        });
      }

      const ip = getClientIp(request);
      const lockout = await getShareLockoutStatus(token, ip);

      if (lockout.isLockedOut) {
        return reply.status(429).send({
          passwordRequired: true,
          folderName,
          shareToken: token,
          turnstileRequired: Boolean(process.env.TURNSTILE_SECRET),
          isLockedOut: true,
          lockoutMessage: `Too many failed attempts. Please try again in ${lockout.remainingMinutes} minute(s).`
        });
      }

      return reply.status(401).send({
        passwordRequired: true,
        folderName,
        shareToken: token,
        turnstileRequired: Boolean(process.env.TURNSTILE_SECRET)
      });
    }

    const tsCookie = request.cookies[`ts_${token}`];
    if (process.env.TURNSTILE_SECRET && !tsCookie) {
      if (isSocialCrawler) {
        // Return minimal Open Graph metadata only, without exposing private gallery contents
        const folderPath = share.folder_path || '';
        const folderName = folderPath ? (folderPath.split('/').pop() || folderPath) : (share.person_id ? 'Person Gallery' : 'Shared Album');
        let coverId = share.media_id || null;
        if (!coverId && folderPath) {
          const fsRes = await query('SELECT cover_media_id, auto_cover_media_id, description FROM folder_settings WHERE folder_path = $1', [folderPath]);
          if (fsRes.rows.length > 0) {
            coverId = fsRes.rows[0].cover_media_id || fsRes.rows[0].auto_cover_media_id || null;
          }
        }
        return reply.send({
          share: { id: share.id, folder_path: share.folder_path, expires_at: share.expires_at },
          files: [],
          directories: [],
          folderCoverId: coverId,
          folderName,
          crawlerPreview: true
        });
      }
      return reply.status(403).send({ error: 'turnstile_required' });
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
          fullPath: resolveMediaFullPath(f.folder_path, f.file_name), 
          mimeType: f.mime_type 
        }, { priority: 2 })
      )).catch(err => console.error('Failed to queue metadata jobs', err));

      Promise.all(missingThumbs.map((f: any) => {
        const fPath = resolveMediaFullPath(f.folder_path, f.file_name);
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
          SELECT fe.media_id AS id, fe.bounding_box,
                 COALESCE(m.img_width, (m.exif_json->>'width')::int) AS img_width,
                 COALESCE(m.img_height, (m.exif_json->>'height')::int) AS img_height
          FROM face_embeddings fe
          JOIN media_files m ON m.id = fe.media_id
          WHERE fe.person_id = $1
            AND m.mime_type LIKE 'image/%'
          ORDER BY ${PERSON_COVER_ORDER_CLAUSE}
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
          SELECT fe.bounding_box,
                 COALESCE(m.img_width, (m.exif_json->>'width')::int) AS img_width,
                 COALESCE(m.img_height, (m.exif_json->>'height')::int) AS img_height
          FROM face_embeddings fe
          JOIN media_files m ON m.id = fe.media_id
          WHERE fe.person_id = $1 AND fe.media_id = $2
          ORDER BY ${PERSON_COVER_ORDER_CLAUSE}
          LIMIT 1
        `, [share.person_id, personCoverMediaId]);
        if (explicitRes.rows.length > 0) {
          personCoverBoundingBox = explicitRes.rows[0].bounding_box;
          personCoverImgWidth = explicitRes.rows[0].img_width;
          personCoverImgHeight = explicitRes.rows[0].img_height;
        } else {
          const mfRes = await query(`
            SELECT COALESCE(img_width, (exif_json->>'width')::int) AS img_width,
                   COALESCE(img_height, (exif_json->>'height')::int) AS img_height
            FROM media_files WHERE id = $1
          `, [personCoverMediaId]);
          if (mfRes.rows.length > 0) {
            personCoverImgWidth = mfRes.rows[0].img_width;
            personCoverImgHeight = mfRes.rows[0].img_height;
          }
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

      const { q: personQ } = (request.query || {}) as { q?: string };
      let personFiles = fileRes.rows;
      if (personQ && personQ.trim().length > 0) {
        const escapedPQ = personQ.trim().replace(/([%_\\])/g, '\\$1');
        const pSearchRes = await query(`
          SELECT m.id, m.folder_path, m.file_name, m.mime_type, m.size_bytes, m.blurhash, m.exif_json, 
                 m.has_1080p, m.has_480p, m.is_transcoded, m.transcoded_mp4_path, m.transcoded_webm_path, 
                 m.created_at, m.updated_at, m.img_width, m.img_height 
          FROM person_faces pf 
          JOIN face_embeddings fe ON fe.id = pf.face_id 
          JOIN media_files m ON m.id = fe.media_id 
          WHERE pf.person_id = $1 AND m.file_name ILIKE $2 ESCAPE '\\'
          GROUP BY m.id
          ORDER BY m.file_name ASC
          LIMIT 300
        `, [share.person_id, `%${escapedPQ}%`]);
        personFiles = pSearchRes.rows;
      }

      return reply.send({ share, files: personFiles, directories: [], person, personCoverMediaId, personCoverBoundingBox, personCoverImgWidth, personCoverImgHeight, defaultShareViewMode: 'small-fit', defaultShareSortMode: 'oldest', defaultShareFolderViewMode: 'small-grid', searching: Boolean(personQ && personQ.trim()) });
    }
    
    let targetPath = (share.folder_path || '').replace(/\\/g, '/');
    const baseFolderPath = targetPath;
    if (subPath) {
      const cleanSub = path.normalize(subPath).replace(/^(\.\.[\/\\])+/, '');
      targetPath = targetPath ? path.join(targetPath, cleanSub).replace(/\\/g, '/') : cleanSub;
    }
    // Update share.folder_path to targetPath so the frontend sees the current folder
    share.folder_path = targetPath;

    const { q } = (request.query || {}) as { q?: string };
    if (q && q.trim().length > 0) {
      const searchQuery = q.trim();
      const escapedQuery = searchQuery.replace(/([%_\\])/g, '\\$1');
      const searchLike = `%${escapedQuery}%`;

      let filesResult;
      if (!targetPath) {
        filesResult = await query(
          `SELECT id, folder_path, file_name, mime_type, size_bytes, blurhash, exif_json, has_1080p, has_480p, is_transcoded, transcoded_mp4_path, transcoded_webm_path, created_at, updated_at, img_width, img_height, is_favorite 
           FROM media_files 
           WHERE file_name ILIKE $1 ESCAPE '\\' 
           ORDER BY file_name ASC 
           LIMIT 300`,
          [searchLike]
        );
      } else {
        const escapedTarget = targetPath.replace(/([%_\\])/g, '\\$1');
        filesResult = await query(
          `SELECT id, folder_path, file_name, mime_type, size_bytes, blurhash, exif_json, has_1080p, has_480p, is_transcoded, transcoded_mp4_path, transcoded_webm_path, created_at, updated_at, img_width, img_height, is_favorite 
           FROM media_files 
           WHERE file_name ILIKE $1 ESCAPE '\\' 
             AND (folder_path = $2 OR folder_path LIKE $3 ESCAPE '\\') 
           ORDER BY file_name ASC 
           LIMIT 300`,
          [searchLike, targetPath, `${escapedTarget}/%`]
        );
      }

      const filesWithRel = filesResult.rows.map(f => {
        let relativePath = f.file_name;
        if (!targetPath) {
          relativePath = f.folder_path ? `${f.folder_path}/${f.file_name}` : f.file_name;
        } else if (f.folder_path === targetPath) {
          relativePath = f.file_name;
        } else if (f.folder_path.startsWith(targetPath + '/')) {
          relativePath = `${f.folder_path.slice(targetPath.length + 1)}/${f.file_name}`;
        }
        return {
          ...f,
          relative_path: relativePath
        };
      });

      // Find matching subfolders under targetPath
      let foldersRes;
      if (!targetPath) {
        foldersRes = await query(`
          SELECT DISTINCT folder_path FROM (
            SELECT folder_path FROM media_files WHERE folder_path != '' AND folder_path IS NOT NULL
            UNION
            SELECT folder_path FROM folder_settings WHERE folder_path != '' AND folder_path IS NOT NULL
          ) sub
          WHERE folder_path != '' AND folder_path IS NOT NULL
        `);
      } else {
        const escapedTarget = targetPath.replace(/([%_\\])/g, '\\$1');
        foldersRes = await query(`
          SELECT DISTINCT folder_path FROM (
            SELECT folder_path FROM media_files WHERE (folder_path = $1 OR folder_path LIKE $2 ESCAPE '\\')
            UNION
            SELECT folder_path FROM folder_settings WHERE (folder_path = $1 OR folder_path LIKE $2 ESCAPE '\\')
          ) sub
          WHERE folder_path != '' AND folder_path IS NOT NULL AND folder_path != $1
        `, [targetPath, `${escapedTarget}/%`]);
      }

      const subfolderPathsSet = new Set<string>();
      for (const row of foldersRes.rows) {
        const fp: string = row.folder_path;
        if (!fp) continue;
        let remainder = '';
        if (!targetPath) {
          remainder = fp;
        } else if (fp.startsWith(targetPath + '/')) {
          remainder = fp.slice(targetPath.length + 1);
        } else {
          continue;
        }

        const segments = remainder.split('/').filter(Boolean);
        let curRel = '';
        for (const seg of segments) {
          curRel = curRel ? `${curRel}/${seg}` : seg;
          const fullSubPath = targetPath ? `${targetPath}/${curRel}` : curRel;
          subfolderPathsSet.add(fullSubPath);
        }
      }

      const matchingFolders: { name: string, path: string, relative_path: string, path_from_share: string }[] = [];
      for (const fullSubPath of subfolderPathsSet) {
        const folderName = fullSubPath.split('/').pop()!;
        if (folderName.toLowerCase().includes(searchQuery.toLowerCase())) {
          const relPath = targetPath ? (fullSubPath.startsWith(targetPath + '/') ? fullSubPath.slice(targetPath.length + 1) : fullSubPath) : fullSubPath;
          const pathFromShare = baseFolderPath ? (fullSubPath.startsWith(baseFolderPath + '/') ? fullSubPath.slice(baseFolderPath.length + 1) : fullSubPath) : fullSubPath;
          matchingFolders.push({
            name: folderName,
            path: fullSubPath,
            relative_path: relPath,
            path_from_share: pathFromShare
          });
        }
      }

      matchingFolders.sort((a, b) => a.name.localeCompare(b.name));
      const limitedFolders = matchingFolders.slice(0, 50);

      const coverMap = new Map<string, { id: string, blurhash: string | null, bounding_box: any, img_width: number | null, img_height: number | null }>();
      const subPaths = limitedFolders.map(f => f.path);

      if (subPaths.length > 0) {
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
          console.error('Failed to batch query folder covers for share search', batchErr);
        }

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
            }
          } catch (fallbackErr: any) {
            console.error('Failed to query fallback covers for share search', fallbackErr);
          }
        }
      }

      const directories = limitedFolders.map(f => {
        const c = coverMap.get(f.path);
        return {
          name: f.name,
          path: f.path,
          relative_path: f.relative_path,
          path_from_share: f.path_from_share,
          cover_id: c?.id || null,
          blurhash: c?.blurhash || null,
          cover_bounding_box: c?.bounding_box || null,
          cover_img_width: c?.img_width || null,
          cover_img_height: c?.img_height || null
        };
      });

      return reply.send({
        share,
        files: filesWithRel,
        directories,
        searching: true,
        query: searchQuery,
        folderCoverId: null,
        folderDescription: '',
        folderPath: targetPath,
        baseFolderPath,
        defaultShareViewMode: 'small-fit',
        defaultShareSortMode: 'oldest',
        defaultShareFolderViewMode: 'small-grid'
      });
    }

    // Fetch folder contents (always return all files so client can toggle between curated and all views instantaneously)
    const filesResult = await query(
      `SELECT id, folder_path, file_name, mime_type, size_bytes, blurhash, exif_json, has_1080p, has_480p, 
              is_transcoded, transcoded_mp4_path, transcoded_webm_path, created_at, updated_at, img_width, img_height, is_staged,
              burst_group_id, is_hero, quality_score, face_count, is_favorite,
              CASE 
                WHEN media_files.burst_group_id IS NOT NULL THEN (
                  SELECT COUNT(*)::int 
                  FROM media_files b 
                  WHERE b.burst_group_id = media_files.burst_group_id
                )
                ELSE 1 
              END as burst_count
       FROM media_files 
       WHERE folder_path = $1 AND (is_hidden_staging = false OR is_hidden_staging IS NULL)
       ORDER BY file_name ASC`, 
      [targetPath]
    );
    const files = filesResult.rows;

    const missingMetadata = files.filter((f: any) => f.exif_json == null);
    const missingThumbs = files.filter((f: any) => !f.has_480p || !f.has_1080p);

    Promise.all(missingMetadata.map((f: any) => 
      metadataQueue.add('extract-metadata', { 
        mediaId: f.id, 
        fullPath: resolveMediaFullPath(f.folder_path, f.file_name), 
        mimeType: f.mime_type 
      }, { priority: 2 })
    )).catch(err => console.error('Failed to queue metadata jobs', err));

    Promise.all(missingThumbs.map((f: any) => {
      const fPath = resolveMediaFullPath(f.folder_path, f.file_name);
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
    const dirsCacheKey = `share:dirs:${token}:${targetPath}`;
    let directories: { name: string, cover_id: string | null, blurhash: string | null, cover_bounding_box?: any, cover_img_width?: number | null, cover_img_height?: number | null }[] = [];
    let dirsCached = false;
    try {
      const cached = await redis.get(dirsCacheKey);
      if (cached) {
        directories = JSON.parse(cached);
        dirsCached = true;
      }
    } catch (e) {
      // Redis error fallback
    }

    if (!dirsCached) {
      try {
        if (fs.existsSync(fullPath)) {
          const items = await fs.promises.readdir(fullPath, { withFileTypes: true });
          
          const dirNames = items.filter(item => item.isDirectory()).map(item => item.name);
          
          if (dirNames.length > 0) {
            const subPaths = dirNames.map(name => targetPath ? `${targetPath}/${name}` : name);
            const coverMap = new Map<string, any>();

            // 1. Batch query all custom / pre-calculated covers
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
              console.error('Failed to batch query folder covers for share', batchErr);
            }

            // 2. Batch query fallback covers for subfolders missing covers
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
                console.error('Failed to batch query fallback covers for share', fallbackErr);
              }
            }

            directories = dirNames.map((name, idx) => {
              const sp = subPaths[idx];
              const c = coverMap.get(sp);
              return {
                name,
                cover_id: c?.id || null,
                blurhash: c?.blurhash || null,
                cover_bounding_box: c?.bounding_box || null,
                cover_img_width: c?.img_width || null,
                cover_img_height: c?.img_height || null
              };
            });
            directories.sort((a, b) => a.name.localeCompare(b.name));
          }

          // Cache in Redis for 10 minutes (600s)
          redis.set(dirsCacheKey, JSON.stringify(directories), 'EX', 600).catch(() => {});
        }
      } catch (e) {
        console.error('Failed to read directory:', fullPath, e);
      }
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

    let isStagedFolder = false;
    let stagingNotice = null;
    if (targetPath) {
      const stagedCheck = await query(`
        SELECT 1 FROM media_files 
        WHERE (folder_path = $1 OR folder_path LIKE $1 || '/%') AND is_staged = true 
        LIMIT 1
      `, [targetPath]).catch(() => ({ rows: [] }));
      isStagedFolder = stagedCheck.rows.length > 0;
      if (isStagedFolder) {
        stagingNotice = await FastUpService.getStagingNotice();
      }
    }

    const shareObj = {
      ...share,
      has_password: Boolean(share.password_hash)
    };
    delete shareObj.password_hash;

    return reply.send({
      share: shareObj,
      files: filesResult.rows,
      directories,
      folderCoverId,
      folderCoverBoundingBox,
      folderCoverImgWidth,
      folderCoverImgHeight,
      folderDescription,
      isStagedFolder,
      stagingNotice,
      folderPath: targetPath,
      baseFolderPath,
      defaultShareViewMode: shareDefaults.defaultShareViewMode,
      defaultShareSortMode: shareDefaults.defaultShareSortMode,
      defaultShareFolderViewMode: shareDefaults.defaultShareFolderViewMode
    });
  }

  fastify.get<{ Params: { token: string } }>('/api/shares/:token', handleShareGet);

  /**
   * GET /api/shares/:token/media/:id/alternates
   * Fetches peer photos in a burst group under a public share link.
   */
  fastify.get<{ Params: { token: string, id: string } }>('/api/shares/:token/media/:id/alternates', async (request, reply) => {
    const { token, id } = request.params;
    const shareRes = await query(`SELECT * FROM shared_folders WHERE share_token = $1 AND is_active = true`, [token]);
    if (shareRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Share not found' });
    }
    const share = shareRes.rows[0];
    if (share.expires_at && new Date(share.expires_at) <= new Date()) {
      return reply.status(401).send({ error: 'Share has expired' });
    }
    if (!isSharePasswordUnlocked(share, token, request)) {
      return reply.status(401).send({ error: 'Password required' });
    }
    if (share.show_hidden_alternates === false) {
      return reply.status(403).send({ error: 'Alternate photos are restricted on this share link' });
    }

    try {
      const alternates = await StagingService.getAlternates(id);
      return reply.send({ success: true, alternates });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/shares/:token/media/:id/set-hero
   * Promotes an alternate photo to Hero if permitted on the share link.
   */
  fastify.post<{ Params: { token: string, id: string } }>('/api/shares/:token/media/:id/set-hero', async (request, reply) => {
    const { token, id } = request.params;
    const shareRes = await query(`SELECT * FROM shared_folders WHERE share_token = $1 AND is_active = true`, [token]);
    if (shareRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Share not found' });
    }
    const share = shareRes.rows[0];
    if (share.expires_at && new Date(share.expires_at) <= new Date()) {
      return reply.status(401).send({ error: 'Share has expired' });
    }
    if (!isSharePasswordUnlocked(share, token, request)) {
      return reply.status(401).send({ error: 'Password required' });
    }

    const photogHeader = request.headers['x-photographer-token'] as string | undefined;
    const isPhotographer = Boolean(photogHeader && photogHeader.trim().startsWith('ph_tok_'));
    if (!share.allow_hero_selection && !isPhotographer) {
      return reply.status(403).send({ error: 'Changing hero photo is not permitted for guests' });
    }

    try {
      const result = await StagingService.setHero(id);
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * POST /api/shares/:token/media/:id/toggle-visibility
   * Toggles show/hide visibility for an alternate photo.
   */
  fastify.post<{ Params: { token: string, id: string }; Body: { show?: boolean } }>('/api/shares/:token/media/:id/toggle-visibility', async (request, reply) => {
    const { token, id } = request.params;
    const { show } = (request.body || {}) as { show?: boolean };
    const shareRes = await query(`SELECT * FROM shared_folders WHERE share_token = $1 AND is_active = true`, [token]);
    if (shareRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Share not found' });
    }
    const share = shareRes.rows[0];
    if (share.expires_at && new Date(share.expires_at) <= new Date()) {
      return reply.status(401).send({ error: 'Share has expired' });
    }
    if (!isSharePasswordUnlocked(share, token, request)) {
      return reply.status(401).send({ error: 'Password required' });
    }

    const photogHeader = request.headers['x-photographer-token'] as string | undefined;
    const isPhotographer = Boolean(photogHeader && photogHeader.trim().startsWith('ph_tok_'));
    if (!share.allow_hero_selection && !isPhotographer) {
      return reply.status(403).send({ error: 'Modifying photo visibility is not permitted for guests' });
    }

    try {
      const result = await StagingService.toggleVisibility(id, show);
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * POST /api/shares/:token/media/:id/favorite
   * Toggles favorite status for a media item if permitted on the share link.
   */
  fastify.post<{ Params: { token: string, id: string }; Body: { is_favorite?: boolean } }>('/api/shares/:token/media/:id/favorite', async (request, reply) => {
    const { token, id } = request.params;
    const { is_favorite } = (request.body || {}) as { is_favorite?: boolean };
    const shareRes = await query(`SELECT * FROM shared_folders WHERE share_token = $1 AND is_active = true`, [token]);
    if (shareRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Share not found' });
    }
    const share = shareRes.rows[0];
    if (share.expires_at && new Date(share.expires_at) <= new Date()) {
      return reply.status(401).send({ error: 'Share has expired' });
    }
    if (!isSharePasswordUnlocked(share, token, request)) {
      return reply.status(401).send({ error: 'Password required' });
    }

    if (!share.allow_favorites) {
      return reply.status(403).send({ error: 'Favoriting photos is not permitted on this share link' });
    }

    // Verify media belongs to shared folder, person, or single media
    let mediaCheck;
    if (share.folder_path) {
      const escapedFolder = share.folder_path.replace(/([%_\\])/g, '\\$1');
      mediaCheck = await query(
        `SELECT id, is_favorite FROM media_files WHERE id = $1 AND (folder_path = $2 OR folder_path LIKE $3 ESCAPE '\\')`,
        [id, share.folder_path, `${escapedFolder}/%`]
      );
    } else if (share.person_id) {
      mediaCheck = await query(
        `SELECT m.id, m.is_favorite FROM person_faces pf 
         JOIN face_embeddings fe ON fe.id = pf.face_id 
         JOIN media_files m ON m.id = fe.media_id 
         WHERE pf.person_id = $1 AND m.id = $2 LIMIT 1`,
        [share.person_id, id]
      );
    } else if (share.media_id) {
      mediaCheck = await query(`SELECT id, is_favorite FROM media_files WHERE id = $1 AND id = $2`, [id, share.media_id]);
    }

    if (!mediaCheck || mediaCheck.rows.length === 0) {
      return reply.status(404).send({ error: 'Media file not found in this share' });
    }

    const currentFav = mediaCheck.rows[0].is_favorite ?? false;
    const nextFav = typeof is_favorite === 'boolean' ? is_favorite : !currentFav;
    await query(`UPDATE media_files SET is_favorite = $1, updated_at = NOW() WHERE id = $2`, [nextFav, id]);
    return reply.send({ success: true, id, is_favorite: nextFav });
  });

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
      SELECT s.id, s.share_token, s.allow_download_images, s.allow_download_folder, s.allow_favorites, s.allow_filter_favorites, s.watermark_enabled, s.watermark_template_id, wt.name as watermark_template_name, s.expires_at, s.created_at,
             s.is_active,
             u.name as created_by_name, s.created_by, s.folder_path,
             (s.password_hash IS NOT NULL) as has_password,
             s.label
      FROM shared_folders s
      LEFT JOIN users u ON s.created_by = u.id
      LEFT JOIN watermark_templates wt ON s.watermark_template_id = wt.id
      WHERE s.folder_path = ANY($1::text[])
      ORDER BY (s.folder_path = $2) DESC, s.created_at DESC
    `, [pathsToCheck, folderPath]);

    const shares = result.rows.map(row => {
      if (!isAdmin && row.created_by !== request.user!.id) {
        return {
          ...row,
          has_password: Boolean(row.has_password),
          share_token: row.share_token.substring(0, 8) + '***',
          can_manage: false
        };
      }
      return {
        ...row,
        has_password: Boolean(row.has_password),
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
      SELECT s.id, s.share_token, s.allow_download_images, s.allow_download_folder, s.allow_favorites, s.allow_filter_favorites, s.watermark_enabled, s.watermark_template_id, wt.name as watermark_template_name, s.expires_at, s.created_at,
             s.is_active,
             u.name as created_by_name, s.created_by, s.person_id,
             (s.password_hash IS NOT NULL) as has_password,
             s.label
      FROM shared_folders s
      LEFT JOIN users u ON s.created_by = u.id
      LEFT JOIN watermark_templates wt ON s.watermark_template_id = wt.id
      WHERE s.person_id = $1
      ORDER BY s.created_at DESC
    `, [id]);

    const shares = result.rows.map(row => {
      if (!isAdmin && row.created_by !== request.user!.id) {
        return { ...row, has_password: Boolean(row.has_password), share_token: row.share_token.substring(0, 8) + '***', can_manage: false };
      }
      return { ...row, has_password: Boolean(row.has_password), can_manage: true };
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
    invalidateShareCache(token);
    try {
      await deleteKeysByPattern(`share:dirs:${token}:*`);
    } catch (e) {}
    
    return reply.send({ success: true });
  });

  fastify.patch<{ Params: { token: string } }>('/api/shares/:token', { preHandler: requireAuth }, async (request, reply) => {
    const { token } = request.params;
    const { 
      isActive, 
      expiresAt, 
      allowDownloadImages, 
      allowDownloadFolder, 
      watermarkEnabled,
      watermarkTemplateId,
      allowFavorites,
      allowFilterFavorites
    } = request.body as { 
      isActive?: boolean; 
      expiresAt?: string | null;
      allowDownloadImages?: boolean;
      allowDownloadFolder?: boolean;
      watermarkEnabled?: boolean;
      watermarkTemplateId?: string | null;
      allowFavorites?: boolean;
      allowFilterFavorites?: boolean;
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

    if (typeof allowFavorites === 'boolean') {
      updates.push(`allow_favorites = $${idx++}`);
      values.push(allowFavorites);
    }

    if (typeof allowFilterFavorites === 'boolean') {
      updates.push(`allow_filter_favorites = $${idx++}`);
      values.push(allowFilterFavorites);
    }

    if (watermarkTemplateId !== undefined) {
      updates.push(`watermark_template_id = $${idx++}`);
      values.push(watermarkTemplateId || null);
      if (watermarkTemplateId) {
        updates.push(`watermark_enabled = true`);
      }
    }

    const bodyObj = request.body as any;
    if (bodyObj.label !== undefined) {
      updates.push(`label = $${idx++}`);
      values.push(bodyObj.label ? String(bodyObj.label).trim() : null);
    }
    const newCreatedAt = bodyObj.createdAt || bodyObj.created_at;
    if (newCreatedAt !== undefined) {
      updates.push(`created_at = $${idx++}`);
      values.push(newCreatedAt ? new Date(newCreatedAt).toISOString() : new Date().toISOString());
    }

    if (bodyObj.removePassword === true || bodyObj.password === null) {
      updates.push(`password_hash = NULL`);
    } else if (typeof bodyObj.password === 'string' && bodyObj.password.trim()) {
      const hashed = await bcrypt.hash(bodyObj.password.trim(), 10);
      updates.push(`password_hash = $${idx++}`);
      values.push(hashed);
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

    invalidateShareCache(token);
    try {
      await deleteKeysByPattern(`share:dirs:${token}:*`);
    } catch (e) {}

    const updatedRow = updateRes.rows[0];
    const returnShare = {
      ...updatedRow,
      has_password: Boolean(updatedRow.password_hash)
    };
    delete returnShare.password_hash;

    return reply.send({ success: true, share: returnShare });
  });

  // Public endpoint for share modal to query available watermark templates
  fastify.get('/api/shares/watermark-templates', async (request, reply) => {
    try {
      const templates = await WatermarkService.getAllTemplates();
      const { enforceGlobal, globalTemplateId } = await WatermarkService.getGlobalEnforcement();
      return reply.send({
        templates: templates.map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          is_default: t.is_default,
          type: t.type,
          allow_hd_download: t.allow_hd_download,
          restricted_tier: t.restricted_tier
        })),
        globalEnforced: enforceGlobal,
        globalTemplateId: globalTemplateId
      });
    } catch (e: any) {
      request.log.error(e);
      return reply.status(500).send({ error: e.message });
    }
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

    if (await isShareLockdownActive()) {
      return reply.status(403).send({ error: 'Lockdown active' });
    }

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
