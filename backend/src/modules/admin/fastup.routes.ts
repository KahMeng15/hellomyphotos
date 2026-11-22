import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { FastUpService, resolveClientIp } from '../staging/fastup.service';
import { StagingService } from '../staging/staging.service';
import { requireAuth } from '../../utils/auth';

export async function fastupRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/staging/otp/claim
   * Public endpoint called by FastUp Android app with a 6-digit code.
   * Exchanges OTP for persistent photographer token and predefined settings.
   */
  fastify.post('/api/staging/otp/claim', async (request: FastifyRequest, reply: FastifyReply) => {
    const { otp, clientIp: explicitIp } = (request.body as any) || {};
    if (!otp) {
      return reply.status(400).send({ error: 'Missing 6-digit OTP code' });
    }

    try {
      const clientIp = resolveClientIp(request, explicitIp);
      const claimed = await FastUpService.claimOtp(String(otp), clientIp);
      return reply.send(claimed);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Failed to claim OTP' });
    }
  });

  /**
   * Admin routes below — require authentication and non-viewer role.
   */
  fastify.register(async (adminScope) => {
    adminScope.addHook('onRequest', requireAuth);
    adminScope.addHook('onRequest', async (request, reply) => {
      if (reply.sent) return;
      if (request.user?.role === 'viewer') {
        return reply.status(403).send({ error: 'Forbidden: Viewers cannot manage FastUp tethering' });
      }
    });

    /**
     * POST /api/admin/fastup/otp
     * Generate 6-digit OTP code with scope and predefined settings for FastUp.
     */
    adminScope.post('/api/admin/fastup/otp', async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body as any) || {};
      const { photographerName, folderPath, validityHours, settings } = body;

      if (!folderPath || !photographerName) {
        return reply.status(400).send({ error: 'Folder path and photographer name are required' });
      }

      try {
        const result = await FastUpService.createOtp({
          photographerName,
          folderPath,
          validityHours: validityHours ? Number(validityHours) : 24,
          settings,
          userId: request.user?.id
        });
        return reply.send(result);
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    });

    /**
     * GET /api/admin/fastup/tokens
     * List all photographer tokens and their live status.
     */
    adminScope.get('/api/admin/fastup/tokens', async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const tokens = await FastUpService.listTokens();
        return reply.send(tokens);
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    });

    /**
     * DELETE /api/admin/fastup/tokens/:id
     * Revoke / delete a photographer token.
     */
    adminScope.delete<{ Params: { id: string } }>('/api/admin/fastup/tokens/:id', async (request, reply) => {
      const { id } = request.params;
      try {
        const revoked = await FastUpService.revokeToken(id);
        return reply.send({ success: revoked });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    });

    /**
     * PATCH /api/admin/fastup/tokens/:id/toggle-active
     * Disable or enable an OTP photographer session.
     */
    adminScope.patch<{ Params: { id: string }; Body: { isActive?: boolean } }>('/api/admin/fastup/tokens/:id/toggle-active', async (request, reply) => {
      const { id } = request.params;
      const { isActive } = (request.body as any) || {};
      try {
        const result = await FastUpService.toggleTokenActive(id, isActive);
        return reply.send(result);
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    });

    /**
     * POST /api/admin/fastup/tokens/:id/refresh-otp
     * Generate a new 6-digit OTP code for an existing photographer session.
     */
    adminScope.post<{ Params: { id: string }; Body: { validityHours?: number } }>('/api/admin/fastup/tokens/:id/refresh-otp', async (request, reply) => {
      const { id } = request.params;
      const { validityHours } = (request.body as any) || {};
      try {
        const result = await FastUpService.refreshOtp(id, validityHours ? Number(validityHours) : 24);
        return reply.send(result);
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    });

    /**
     * PUT /api/admin/fastup/tokens/:id
     * Edit photographer session settings, name, or folder path.
     */
    adminScope.put<{ Params: { id: string } }>('/api/admin/fastup/tokens/:id', async (request, reply) => {
      const { id } = request.params;
      const body = (request.body as any) || {};
      try {
        const result = await FastUpService.updateToken(id, {
          photographerName: body.photographerName,
          folderPath: body.folderPath,
          settings: body.settings,
          validityHours: body.validityHours ? Number(body.validityHours) : undefined
        });
        return reply.send(result);
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    });

    /**
     * GET /api/admin/fastup/folders
     * Returns all available folders across permanent media library and staging.
     */
    adminScope.get('/api/admin/fastup/folders', async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const folders = await StagingService.listFolders();
        return reply.send({ success: true, folders });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    });

    /**
     * GET /api/admin/fastup/stats
     * Get storage disk usage, upload counts, and queue processing stats.
     * Query param: sessionId (optional filter for single session stats)
     */
    adminScope.get('/api/admin/fastup/stats', async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId } = (request.query as any) || {};
      try {
        const stats = await FastUpService.getStats(sessionId ? String(sessionId).trim() : undefined);
        return reply.send(stats);
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    });

    /**
     * POST /api/admin/fastup/retry-failed
     * Retry failed jobs in the staging pipeline.
     */
    adminScope.post('/api/admin/fastup/retry-failed', async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const res = await FastUpService.retryFailedJobs();
        return reply.send(res);
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    });

    /**
     * GET /api/admin/fastup/reconcile
     * Reconcile staging photos with media volume photos via EXIF metadata.
     * Query params: sessionId, mediaFolder (optional, defaults to sessionId)
     */
    adminScope.get('/api/admin/fastup/reconcile', async (request: FastifyRequest, reply: FastifyReply) => {
      const query = (request.query as any) || {};
      const sessionId = query.sessionId || query.session_id;
      const mediaFolder = query.mediaFolder || query.media_folder || sessionId;

      if (!sessionId) {
        return reply.status(400).send({ error: 'sessionId query parameter is required' });
      }

      try {
        const reconcile = await FastUpService.reconcileSession(sessionId, mediaFolder);
        return reply.send(reconcile);
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    });

    /**
     * POST /api/admin/fastup/relink
     * Relink staging folder to a different media folder, adopting shares, settings, and covers.
     */
    adminScope.post('/api/admin/fastup/relink', async (request: FastifyRequest, reply: FastifyReply) => {
      const { sourceStagingPath, targetMediaPath } = (request.body as any) || {};
      if (!sourceStagingPath || !targetMediaPath) {
        return reply.status(400).send({ error: 'sourceStagingPath and targetMediaPath are required' });
      }

      try {
        const res = await FastUpService.relinkFolder(sourceStagingPath, targetMediaPath);
        return reply.send(res);
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    });

    /**
     * POST /api/admin/fastup/sessions/:sessionId/hide
     * Manually toggle visibility of live staging photos in HelloMyPhotos.
     */
    adminScope.post<{ Params: { sessionId: string } }>('/api/admin/fastup/sessions/:sessionId/hide', async (request, reply) => {
      const { sessionId } = request.params;
      const { hide } = (request.body as any) || {};

      try {
        const res = await FastUpService.toggleHideStaging(sessionId, Boolean(hide));
        return reply.send(res);
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    });

    /**
     * DELETE /api/admin/fastup/sessions/:sessionId/purge
     * Purge staging files and unlinks DB records for completed event session.
     */
    adminScope.delete<{ Params: { sessionId: string } }>('/api/admin/fastup/sessions/:sessionId/purge', async (request, reply) => {
      const { sessionId } = request.params;
      try {
        const res = await FastUpService.purgeStaging(sessionId);
        return reply.send(res);
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    });

    /**
     * GET /api/admin/fastup/notice
     * Get live staging disclaimer notice configuration.
     */
    adminScope.get('/api/admin/fastup/notice', async (_request, reply) => {
      try {
        const notice = await FastUpService.getStagingNotice();
        return reply.send(notice);
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    });

    /**
     * PUT /api/admin/fastup/notice
     * Update live staging disclaimer notice configuration.
     */
    adminScope.put('/api/admin/fastup/notice', async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body as any) || {};
      try {
        const notice = await FastUpService.updateStagingNotice(body);
        return reply.send({ success: true, notice });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    });
  });
}
