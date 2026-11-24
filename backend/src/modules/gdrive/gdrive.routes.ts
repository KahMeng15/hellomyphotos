import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '../../utils/auth';
import { requireStagingAuth } from '../staging/staging.routes';
import { GDriveService } from './gdrive.service';
import { gdriveSyncQueue } from '../../queue/gdriveSyncQueue';
import { query } from '../../config/db';
import { logger } from '../../utils/logger';

export async function gdriveRoutes(fastify: FastifyInstance) {
  // Public OAuth Callback endpoint (redirect target from Google)
  fastify.get('/api/admin/gdrive/callback', async (request: FastifyRequest<{ Querystring: { code?: string; error?: string; state?: string } }>, reply: FastifyReply) => {
    const { code, error } = request.query;

    const appDomain = (process.env.PUBLIC_APP_DOMAIN || process.env.APP_DOMAIN || '').replace(/\/+$/, '');
    const redirectUrl = `${appDomain}/admin/settings?tab=gdrive`;

    if (error) {
      logger.error(`[GDrive] OAuth callback error: ${error}`);
      return reply.redirect(`${redirectUrl}&error=${encodeURIComponent(error)}`);
    }

    if (!code) {
      return reply.redirect(`${redirectUrl}&error=${encodeURIComponent('No authorization code provided')}`);
    }

    try {
      const account = await GDriveService.handleOAuthCallback(code);
      return reply.redirect(`${redirectUrl}&connected=${encodeURIComponent(account.email)}`);
    } catch (err: any) {
      logger.error('[GDrive] Failed to exchange code for tokens:', err);
      return reply.redirect(`${redirectUrl}&error=${encodeURIComponent(err.message)}`);
    }
  });

  // Admin-only scoped endpoints
  fastify.register(async (adminScope) => {
    adminScope.addHook('onRequest', requireAuth);
    adminScope.addHook('onRequest', async (request, reply) => {
      if (reply.sent) return;
      if (request.user?.role !== 'admin' && request.user?.role !== 'super_admin') {
        return reply.status(403).send({ error: 'Forbidden: Admin access required' });
      }
    });

    // Get Auth URL
    adminScope.get('/api/admin/gdrive/auth-url', async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const url = GDriveService.generateAuthUrl();
        return reply.send({ url });
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    });

    // List connected Google Accounts
    adminScope.get('/api/admin/gdrive/accounts', async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const accounts = await GDriveService.listAccounts();
        return reply.send({ accounts });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    });

    // Delete/disconnect a connected Google Account
    adminScope.delete<{ Params: { id: string } }>('/api/admin/gdrive/accounts/:id', async (request, reply) => {
      try {
        const success = await GDriveService.deleteAccount(request.params.id);
        return reply.send({ success });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    });
  });

  // Folder sync configuration endpoints (Admins, Super Admins & Staging FastUp clients)
  fastify.register(async (folderScope) => {
    folderScope.addHook('onRequest', requireStagingAuth);

    // List connected Google Accounts for folder sync selection
    folderScope.get('/api/gdrive/accounts', async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const accounts = await GDriveService.listAccounts();
        return reply.send({ accounts });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    });

    // Get list of folders on Google Drive
    folderScope.get<{
      Querystring: { accountId: string; parentId?: string }
    }>('/api/gdrive/folders', async (request, reply) => {
      const { accountId, parentId } = request.query;
      if (!accountId) {
        return reply.status(400).send({ error: 'accountId is required' });
      }
      try {
        const folders = await GDriveService.listDriveFolders(accountId, parentId);
        return reply.send({ folders });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    });

    // Get sync info for a folder
    folderScope.get<{
      Querystring: { folderPath: string; sourceType?: 'MEDIA' | 'FASTUP' }
    }>('/api/gdrive/sync', async (request, reply) => {
      const { folderPath, sourceType = 'MEDIA' } = request.query;
      try {
        const sync = await GDriveService.getSyncConfig(folderPath, sourceType);
        if (!sync) {
          return reply.send({ synced: false });
        }

        // Get count of synced files
        const countRes = await query(
          'SELECT COUNT(*) as count FROM gdrive_synced_files WHERE sync_id = $1',
          [sync.id]
        );

        // Get total local JPEG count (distinct file names to match gdrive_synced_files primary key)
        let totalLocalJpegs = 0;
        try {
          if (sourceType === 'FASTUP') {
            const cRes = await query(
              `SELECT COUNT(DISTINCT file_name) as count FROM media_files 
               WHERE (folder_path = $1 OR folder_path LIKE $2) 
                 AND is_staged = true 
                 AND (file_name ILIKE '%.jpg' OR file_name ILIKE '%.jpeg')`,
              [folderPath, `${folderPath}/%`]
            );
            totalLocalJpegs = parseInt(cRes.rows[0]?.count || '0', 10);
          } else {
            const cRes = await query(
              `SELECT COUNT(DISTINCT file_name) as count FROM media_files 
               WHERE (folder_path = $1 OR folder_path LIKE $2) 
                 AND (file_name ILIKE '%.jpg' OR file_name ILIKE '%.jpeg')`,
              [folderPath, `${folderPath}/%`]
            );
            totalLocalJpegs = parseInt(cRes.rows[0]?.count || '0', 10);
          }
        } catch {}

        return reply.send({
          synced: true,
          sync: {
            ...sync,
            syncedFileCount: parseInt(countRes.rows[0]?.count || '0', 10),
            totalLocalJpegs
          }
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    });

    // Create or enable sync for a folder
    folderScope.post<{
      Body: {
        accountId: string;
        folderPath: string;
        sourceType?: 'MEDIA' | 'FASTUP';
        folderName?: string;
        existingFolderId?: string;
      }
    }>('/api/gdrive/sync', async (request, reply) => {
      const { accountId, folderPath, sourceType = 'MEDIA', folderName, existingFolderId } = request.body;

      if (!accountId || folderPath === undefined) {
        return reply.status(400).send({ error: 'accountId and folderPath are required' });
      }

      try {
        const sync = await GDriveService.setSyncConfig({
          accountId,
          sourceType,
          folderPath,
          folderName,
          existingFolderId
        });

        // Trigger immediate background scan & sync of existing JPEGs
        await gdriveSyncQueue.add('sync-folder', {
          type: 'sync-folder',
          folderPath,
          sourceType
        });

        return reply.send({
          success: true,
          sync
        });
      } catch (err: any) {
        logger.error('[GDrive] Failed to create sync:', err);
        return reply.status(500).send({ error: err.message });
      }
    });

    // Trigger immediate manual sync now
    folderScope.post<{
      Body: { folderPath: string; sourceType?: 'MEDIA' | 'FASTUP' }
    }>('/api/gdrive/sync/trigger', async (request, reply) => {
      const { folderPath, sourceType = 'MEDIA' } = request.body;
      try {
        const sync = await GDriveService.getSyncConfig(folderPath, sourceType);
        if (!sync) {
          return reply.status(404).send({ error: 'No active Google Drive sync for this folder' });
        }

        // Unpause if paused
        await query(`UPDATE folder_gdrive_syncs SET is_active = true, sync_status = 'SYNCING' WHERE id = $1`, [sync.id]);

        await gdriveSyncQueue.add('sync-folder', {
          type: 'sync-folder',
          folderPath,
          sourceType
        });

        return reply.send({ success: true, message: 'Sync queued' });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    });

    // Pause or Resume sync
    folderScope.post<{
      Body: { folderPath: string; sourceType?: 'MEDIA' | 'FASTUP'; pause: boolean }
    }>('/api/gdrive/sync/toggle-pause', async (request, reply) => {
      const { folderPath, sourceType = 'MEDIA', pause } = request.body;
      try {
        const sync = await GDriveService.getSyncConfig(folderPath, sourceType);
        if (!sync) {
          return reply.status(404).send({ error: 'No active Google Drive sync for this folder' });
        }

        const newStatus = pause ? 'PAUSED' : 'IDLE';
        const res = await query(
          `UPDATE folder_gdrive_syncs 
           SET sync_status = $1, is_active = $2
           WHERE id = $3
           RETURNING *`,
          [newStatus, !pause, sync.id]
        );

        if (!pause) {
          // If resumed, queue sync-folder to catch up on any missed uploads
          await gdriveSyncQueue.add('sync-folder', {
            type: 'sync-folder',
            folderPath,
            sourceType
          });
        }

        return reply.send({ success: true, sync: res.rows[0] });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    });

    // Remove sync (unlink or optionally delete remote folder)
    folderScope.delete<{
      Body: { folderPath: string; sourceType?: 'MEDIA' | 'FASTUP'; deleteRemote?: boolean }
    }>('/api/gdrive/sync', async (request, reply) => {
      const { folderPath, sourceType = 'MEDIA', deleteRemote = false } = request.body;
      try {
        const success = await GDriveService.removeSyncConfig(folderPath, sourceType, Boolean(deleteRemote));
        return reply.send({ success });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    });

    // Get individual media file Google Drive link
    folderScope.get<{
      Params: { mediaId: string };
    }>('/api/gdrive/media/:mediaId/link', async (request, reply) => {
      const { mediaId } = request.params;
      try {
        const result = await GDriveService.getMediaDriveLink(mediaId);
        return reply.send(result);
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    });
  });
}
