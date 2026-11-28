import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { StagingService, sanitizeSessionId } from './staging.service';
import { FastUpService, resolveClientIp, ScopeSecurity, hashToken } from './fastup.service';
import { STAGING_ROOT } from '../../utils/mediaPath';
import { requireAuth } from '../../utils/auth';
import { query } from '../../config/db';

/**
 * Authentication preHandler for Staging endpoints.
 * Supports:
 *  1. Scoped photographer token: `x-photographer-token` or `Authorization: Bearer ph_tok_...`
 *  2. Header `x-api-key` or `x-staging-key` matching process.env.STAGING_API_KEY (for headless legacy tethering)
 *  3. Standard JWT Bearer token / Cookie session (for authenticated web sessions)
 */
export async function requireStagingAuth(request: FastifyRequest, reply: FastifyReply) {
  // 1. Check photographer token
  const photogHeader = request.headers['x-photographer-token'] as string | undefined;
  const apiKeyHeader = (request.headers['x-api-key'] || request.headers['x-staging-key']) as string | undefined;
  const authHeader = request.headers.authorization;
  let candidateToken: string | undefined = photogHeader;

  if (!candidateToken && apiKeyHeader && apiKeyHeader.trim().startsWith('ph_tok_')) {
    candidateToken = apiKeyHeader.trim();
  }

  if (!candidateToken && authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer.startsWith('ph_tok_')) {
      candidateToken = bearer;
    }
  }

  if (candidateToken) {
    try {
      const tokenHash = hashToken(candidateToken);
      const tokenRes = await query(
        `SELECT id, photographer_name, folder_path, scope_folders, is_active, expires_at, last_seen_at 
         FROM photographer_tokens 
         WHERE token_hash = $1 OR token = $2
         LIMIT 1`,
        [tokenHash, candidateToken]
      );

      if (tokenRes.rows.length > 0) {
        const ph = tokenRes.rows[0];
        if (!ph.is_active) {
          return reply.status(403).send({ error: 'Photographer session is disabled. Please contact the administrator.' });
        }
        if (ph.expires_at && new Date(ph.expires_at) <= new Date()) {
          return reply.status(401).send({ error: 'Photographer token has expired.' });
        }

        const lastSeen = ph.last_seen_at ? new Date(ph.last_seen_at).getTime() : 0;
        const now = Date.now();
        const clientIp = resolveClientIp(request);

        // Log connection activity on new session or if idle for > 5 minutes
        if (!ph.last_seen_at || now - lastSeen > 5 * 60 * 1000) {
          FastUpService.logActivity({
            eventType: 'connection',
            photographerName: ph.photographer_name,
            folderPath: ph.folder_path,
            ipAddress: clientIp,
            status: 'active',
            details: { action: 'token_authenticated' }
          }).catch(() => {});
        }

        query(`UPDATE photographer_tokens SET last_seen_at = NOW() WHERE id = $1`, [ph.id]).catch(() => {});
        const effectiveScopes = ScopeSecurity.getEffectiveScopes(ph.scope_folders, ph.folder_path);
        (request as any).photographer = {
          ...ph,
          scopes: effectiveScopes
        };
        return; // Authorized via Photographer Token
      } else {
        return reply.status(401).send({ error: 'Invalid photographer token' });
      }
    } catch (err: any) {
      return reply.status(500).send({ error: 'Authentication database lookup failed' });
    }
  }

  // 2. Legacy static staging API key
  const apiKey = (request.headers['x-api-key'] || request.headers['x-staging-key']) as string | undefined;
  const configuredKey = process.env.STAGING_API_KEY;

  if (configuredKey && apiKey && apiKey.trim() === configuredKey.trim()) {
    return; // Authorized via Staging API Key
  }

  // 3. User session
  await requireAuth(request, reply);
  if (reply.sent) return;

  if (request.user?.role === 'viewer') {
    return reply.status(403).send({ error: 'Forbidden: Viewers cannot manage staging sessions' });
  }
}

export async function stagingRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/staging/upload
   * Handles multipart file upload (JPEG or RAW) associated with a sessionId.
   * Saves files to /app/staging/<sessionId>/<filename>.
   */
  fastify.post('/api/staging/upload', { preHandler: requireStagingAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.isMultipart()) {
      return reply.status(400).send({ error: 'Expected multipart/form-data request' });
    }

    const querySessionId = (request.query as any)?.sessionId || (request.query as any)?.session_id || (request.query as any)?.folderPath;
    const headerSessionId = (request.headers['x-session-id'] || request.headers['x-sessionid']) as string | undefined;
    const queryFavorite = (request.query as any)?.is_favorite || (request.query as any)?.isFavorite;
    const photog = (request as any).photographer;
    let sessionId = querySessionId || headerSessionId || photog?.folder_path || '';
    let isFavorite: boolean | undefined = typeof queryFavorite === 'string'
      ? (queryFavorite.toLowerCase() === 'true' || queryFavorite === '1')
      : (typeof queryFavorite === 'boolean' ? queryFavorite : undefined);

    const parts = request.parts();
    const uploadedResults: any[] = [];
    const pendingFiles: Array<{ filename: string; tempPath: string; mimetype: string; isFavorite?: boolean }> = [];

    try {
      for await (const part of parts) {
        if (part.type === 'file') {
          const currentCleanSession = ScopeSecurity.normalizePath(sessionId);
          if (photog && currentCleanSession && !ScopeSecurity.isPathAllowed(currentCleanSession, photog.scopes)) {
            // Early rejection if session specified is outside allowed scope
            return reply.status(403).send({
              error: `Forbidden: Cannot upload photos to '${currentCleanSession}'. Outside allowed scope: ${photog.scopes.join(', ')}`
            });
          }

          if (!sessionId) {
            // Buffer to temporary staging folder until sessionId field is encountered
            const tmpDir = path.join(STAGING_ROOT, '.tmp');
            await fs.promises.mkdir(tmpDir, { recursive: true });
            const tmpFile = path.join(tmpDir, `${crypto.randomUUID()}_${path.basename(part.filename)}`);
            const ws = fs.createWriteStream(tmpFile);
            await pipeline(part.file, ws);
            pendingFiles.push({ filename: part.filename, tempPath: tmpFile, mimetype: part.mimetype, isFavorite });
          } else {
            const res = await StagingService.saveUploadedFile(
              currentCleanSession,
              part.filename,
              part.file,
              part.mimetype,
              isFavorite
            );
            uploadedResults.push(res);
          }
        } else {
          // Multipart text field
          if ((part.fieldname === 'sessionId' || part.fieldname === 'session_id' || part.fieldname === 'folderPath' || part.fieldname === 'folder_path') && typeof part.value === 'string' && part.value.trim().length > 0) {
            sessionId = part.value.trim();
          } else if ((part.fieldname === 'isFavorite' || part.fieldname === 'is_favorite') && typeof part.value === 'string') {
            isFavorite = part.value.trim().toLowerCase() === 'true' || part.value.trim() === '1';
          }
        }
      }

      const finalSessionId = ScopeSecurity.normalizePath(sessionId);

      // Verify photographer permission on final session id
      if (photog) {
        if (!finalSessionId || !ScopeSecurity.isPathAllowed(finalSessionId, photog.scopes)) {
          for (const p of pendingFiles) {
            try { await fs.promises.unlink(p.tempPath); } catch {}
          }
          return reply.status(403).send({
            error: `Forbidden: Cannot upload photos to '${finalSessionId || 'root'}'. Outside allowed scope: ${photog.scopes.join(', ')}`
          });
        }
      }

      // Process any files that were received before the sessionId field was encountered
      if (pendingFiles.length > 0) {
        if (!finalSessionId) {
          for (const p of pendingFiles) {
            try { await fs.promises.unlink(p.tempPath); } catch {}
          }
          return reply.status(400).send({ error: 'Missing sessionId for staging upload' });
        }

        for (const p of pendingFiles) {
          try {
            const fileStream = fs.createReadStream(p.tempPath);
            const res = await StagingService.saveUploadedFile(
              finalSessionId,
              p.filename,
              fileStream,
              p.mimetype,
              p.isFavorite ?? isFavorite
            );
            uploadedResults.push(res);
          } finally {
            try { await fs.promises.unlink(p.tempPath); } catch {}
          }
        }
      }

      if (uploadedResults.length === 0) {
        return reply.status(400).send({ error: 'No files were uploaded or missing sessionId' });
      }

      // Log successful upload activity
      const clientIp = resolveClientIp(request);
      for (const res of uploadedResults) {
        FastUpService.logActivity({
          eventType: 'upload_completed',
          photographerName: photog?.photographer_name || 'FastUp Camera',
          folderPath: finalSessionId,
          fileName: res.fileName,
          fileSizeBytes: res.sizeBytes,
          ipAddress: clientIp,
          status: 'success'
        }).catch(() => {});
      }

      return reply.send({
        success: true,
        sessionId: finalSessionId,
        count: uploadedResults.length,
        files: uploadedResults
      });
    } catch (err: any) {
      // Clean up any remaining temp files on error
      for (const p of pendingFiles) {
        try { await fs.promises.unlink(p.tempPath); } catch {}
      }

      const clientIp = resolveClientIp(request);
      FastUpService.logActivity({
        eventType: 'upload_failed',
        photographerName: photog?.photographer_name || 'FastUp Camera',
        folderPath: sessionId ? ScopeSecurity.normalizePath(sessionId) : null,
        ipAddress: clientIp,
        status: 'failed',
        details: { error: err.message || 'Upload failed' }
      }).catch(() => {});

      return reply.status(500).send({ error: err.message || 'Upload failed' });
    }
  });

  /**
   * POST /api/staging/create-share
   * Generates an on-demand public share link for the staging session.
   */
  fastify.post('/api/staging/create-share', { preHandler: requireStagingAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const rawBody = (request.body || {}) as any;
    const sessionId = rawBody.sessionId || rawBody.session_id;
    const mediaId = rawBody.mediaId || rawBody.media_id;
    const {
      allowDownloadImages,
      allowDownloadFolder,
      watermarkEnabled,
      watermarkTemplateId,
      expiresAt,
      allowViewModeToggle,
      showHiddenAlternates,
      allowHeroSelection,
      defaultStagingView,
      allowFavorites
    } = rawBody;

    if (!sessionId) {
      return reply.status(400).send({ error: 'sessionId is required' });
    }

    const cleanSessionId = ScopeSecurity.normalizePath(sessionId);
    const photog = (request as any).photographer;
    if (photog && !ScopeSecurity.isPathAllowed(cleanSessionId, photog.scopes)) {
      return reply.status(403).send({
        error: `Forbidden: Cannot create share link for '${cleanSessionId}'. Outside allowed scope: ${photog.scopes.join(', ')}`
      });
    }

    try {
      const share = await StagingService.createShare(cleanSessionId, {
        mediaId: mediaId || null,
        allowDownloadImages,
        allowDownloadFolder,
        watermarkEnabled,
        watermarkTemplateId,
        expiresAt,
        createdBy: request.user?.id,
        allowViewModeToggle,
        showHiddenAlternates,
        allowHeroSelection,
        defaultStagingView,
        allowFavorites: allowFavorites ?? true
      });

      return reply.send({
        success: true,
        ...share
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * GET /api/staging/folders
   * Lists all existing staging folder paths recursively, filtered strictly by photographer scope.
   */
  fastify.get('/api/staging/folders', { preHandler: requireStagingAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const folders = await StagingService.listFolders();
      const photog = (request as any).photographer;
      if (photog) {
        const visibleFolders = ScopeSecurity.filterAccessibleFolders(folders, photog.scopes);
        return reply.send({
          success: true,
          folders: visibleFolders,
          scopes: photog.scopes,
          defaultFolder: photog.folder_path,
          photographerName: photog.photographer_name
        });
      }

      return reply.send({
        success: true,
        folders,
        scopes: ['*']
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/staging/folders
   * Creates a folder directory in /app/staging/<folderPath> with recursive support.
   * Enforces that the folder path must be inside the photographer's allowed scope.
   */
  fastify.post('/api/staging/folders', { preHandler: requireStagingAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { folderPath } = (request.body || {}) as any;
    if (!folderPath || typeof folderPath !== 'string') {
      return reply.status(400).send({ error: 'folderPath is required' });
    }

    const cleanPath = ScopeSecurity.normalizePath(folderPath);
    if (!cleanPath) {
      return reply.status(400).send({ error: 'Valid folderPath is required' });
    }

    const photog = (request as any).photographer;
    if (photog && !ScopeSecurity.isPathAllowed(cleanPath, photog.scopes)) {
      return reply.status(403).send({
        error: `Forbidden: Cannot create folder '${cleanPath}'. Outside your allowed scope: ${photog.scopes.join(', ')}`
      });
    }

    try {
      const createdPath = await StagingService.createFolder(cleanPath);
      return reply.send({
        success: true,
        folderPath: createdPath
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * GET /api/staging/sessions
   * Returns list of staging sessions, photo count, and active share URLs.
   */
  fastify.get('/api/staging/sessions', { preHandler: requireStagingAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      let sessions = await StagingService.listSessions();
      const photog = (request as any).photographer;
      if (photog) {
        sessions = sessions.filter(s => ScopeSecurity.isPathAllowed(s.sessionId, photog.scopes));
      }
      const totalPhotos = sessions.reduce((acc, s) => acc + s.photoCount, 0);

      let availableBytes: number | null = null;
      let availableStorage: string | null = null;
      try {
        const stats = await fs.promises.statfs(STAGING_ROOT);
        const blockSize = (stats.frsize && Number(stats.frsize) > 0) ? Number(stats.frsize) : Number(stats.bsize);
        availableBytes = Number(stats.bavail) * blockSize;
        if (availableBytes >= 1024 * 1024 * 1024 * 1024) {
          const tb = availableBytes / (1024 * 1024 * 1024 * 1024);
          availableStorage = tb >= 10 ? `${Math.round(tb)} TB` : `${tb.toFixed(1)} TB`;
        } else if (availableBytes >= 1024 * 1024 * 1024) {
          availableStorage = `${Math.round(availableBytes / (1024 * 1024 * 1024))} GB`;
        } else if (availableBytes >= 1024 * 1024) {
          availableStorage = `${Math.round(availableBytes / (1024 * 1024))} MB`;
        } else {
          availableStorage = `${availableBytes} B`;
        }
      } catch (err: any) {
        console.warn('[StagingRoutes] statfs failed:', err.message);
      }

      return reply.send({
        success: true,
        sessions,
        totalSessions: sessions.length,
        totalPhotos,
        availableBytes,
        availableStorage
      });
    } catch (err: any) {
      console.error('[StagingRoutes] GET /sessions error:', err);
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/staging/media/:id/alternates
   * Returns all peer photos in the burst group for the requested media ID.
   */
  fastify.get<{ Params: { id: string } }>('/api/staging/media/:id/alternates', { preHandler: requireStagingAuth }, async (request, reply) => {
    const { id } = request.params;
    if (!id) return reply.status(400).send({ error: 'Media ID required' });
    try {
      const alternates = await StagingService.getAlternates(id);
      return reply.send({ success: true, alternates });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/staging/media/:id/set-hero
   * Promotes the specified media ID to be the Hero of its burst group.
   */
  fastify.post<{ Params: { id: string } }>('/api/staging/media/:id/set-hero', { preHandler: requireStagingAuth }, async (request, reply) => {
    const { id } = request.params;
    if (!id) return reply.status(400).send({ error: 'Media ID required' });
    try {
      const result = await StagingService.setHero(id);
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * POST /api/staging/media/:id/toggle-visibility
   * Toggles whether an alternate photo is shown or hidden in curated view.
   */
  fastify.post<{ Params: { id: string }; Body: { show?: boolean } }>('/api/staging/media/:id/toggle-visibility', { preHandler: requireStagingAuth }, async (request, reply) => {
    const { id } = request.params;
    const { show } = (request.body || {}) as { show?: boolean };
    if (!id) return reply.status(400).send({ error: 'Media ID required' });
    try {
      const result = await StagingService.toggleVisibility(id, show);
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * POST /api/staging/media/:id/favorite
   * Toggles or sets favorite status for a media item in staging.
   */
  fastify.post<{ Params: { id: string }; Body: { is_favorite?: boolean } }>('/api/staging/media/:id/favorite', { preHandler: requireStagingAuth }, async (request, reply) => {
    const { id } = request.params;
    const { is_favorite } = (request.body || {}) as { is_favorite?: boolean };
    if (!id) return reply.status(400).send({ error: 'Media ID required' });
    try {
      const result = await StagingService.toggleFavorite(id, is_favorite, (request as any).photographer);
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * GET /api/staging/*
   * Returns detailed metadata and photos for a specific staging session (supports nested paths).
   */
  fastify.get<{ Params: { '*': string } }>('/api/staging/*', { preHandler: requireStagingAuth }, async (request, reply) => {
    const rawParam = request.params['*'] || (request.query as any)?.sessionId;
    const safeSessionId = ScopeSecurity.normalizePath(rawParam);
    if (!safeSessionId) return reply.status(400).send({ error: 'Invalid sessionId' });

    const photog = (request as any).photographer;
    if (photog && !ScopeSecurity.isPathAllowed(safeSessionId, photog.scopes)) {
      return reply.status(403).send({
        error: `Forbidden: Cannot view photos in '${safeSessionId}'. Outside your allowed scope: ${photog.scopes.join(', ')}`
      });
    }

    const folderPath = safeSessionId;
    const legacyPath = `staging/${safeSessionId}`;
    const view = ((request.query as any)?.view || 'curated').toLowerCase();
    const curatedFilter = view === 'curated' ? 'AND (is_hero = true OR burst_group_id IS NULL)' : '';

    const filesRes = await query(
      `SELECT id, folder_path, file_name, mime_type, size_bytes, blurhash, exif_json, has_1080p, has_480p, created_at, updated_at, img_width, img_height, is_staged,
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
       WHERE (folder_path = $1 OR folder_path LIKE $2 OR folder_path = $3 OR folder_path LIKE $4) ${curatedFilter}
       ORDER BY created_at DESC`,
      [folderPath, `${folderPath}/%`, legacyPath, `${legacyPath}/%`]
    );

    const sharesRes = await query(
      `SELECT id, share_token, is_active, expires_at, allow_download_images, allow_download_folder, watermark_enabled,
              allow_view_mode_toggle, show_hidden_alternates, allow_hero_selection, default_staging_view, allow_favorites, created_at
       FROM shared_folders
       WHERE (folder_path = $1 OR folder_path LIKE $2 OR folder_path = $3 OR folder_path LIKE $4) AND is_active = true
       ORDER BY created_at DESC`,
      [folderPath, `${folderPath}/%`, legacyPath, `${legacyPath}/%`]
    );

    const appDomain = (process.env.APP_DOMAIN || '').replace(/\/+$/, '');
    const shares = sharesRes.rows.map(s => ({
      id: s.id,
      shareToken: s.share_token,
      share_token: s.share_token,
      shareUrl: appDomain ? `${appDomain}/share/${s.share_token}` : `/share/${s.share_token}`,
      isActive: s.is_active,
      is_active: s.is_active,
      expiresAt: s.expires_at ? new Date(s.expires_at).toISOString() : null,
      expires_at: s.expires_at ? new Date(s.expires_at).toISOString() : null,
      allowDownloadImages: s.allow_download_images,
      allowDownloadFolder: s.allow_download_folder,
      watermarkEnabled: s.watermark_enabled,
      allowViewModeToggle: s.allow_view_mode_toggle,
      showHiddenAlternates: s.show_hidden_alternates,
      allowHeroSelection: s.allow_hero_selection,
      defaultStagingView: s.default_staging_view || 'all',
      allowFavorites: s.allow_favorites ?? true,
      createdAt: new Date(s.created_at).toISOString()
    }));

    return reply.send({
      success: true,
      sessionId: safeSessionId,
      folderPath,
      photoCount: filesRes.rows.length,
      shares,
      photos: filesRes.rows
    });
  });

  /**
   * DELETE /api/staging/*
   * Cleans up/deletes temporary staging images when event is complete (supports nested paths).
   */
  fastify.delete<{ Params: { '*': string } }>('/api/staging/*', { preHandler: requireStagingAuth }, async (request, reply) => {
    const rawParam = request.params['*'] || (request.query as any)?.sessionId || (request.body as any)?.sessionId;
    const safeSessionId = ScopeSecurity.normalizePath(rawParam);
    if (!safeSessionId) {
      return reply.status(400).send({ error: 'sessionId is required' });
    }

    const photog = (request as any).photographer;
    if (photog && !ScopeSecurity.isPathAllowed(safeSessionId, photog.scopes)) {
      return reply.status(403).send({
        error: `Forbidden: Cannot cleanup staging session '${safeSessionId}'. Outside your allowed scope: ${photog.scopes.join(', ')}`
      });
    }

    try {
      const result = await StagingService.cleanupSession(safeSessionId);
      return reply.send({
        success: true,
        message: `Staging session '${result.sessionId}' cleaned up successfully`,
        deletedPhotosCount: result.deletedPhotosCount
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });
}
