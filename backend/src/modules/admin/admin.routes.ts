import bcrypt from 'bcryptjs';
import { requireAuth } from '../../utils/auth';
import { FastifyInstance } from 'fastify';
import { redis } from '../../config/redis';
import { ScannerService } from '../scanner/scanner.service';
import { queues as allQueues } from '../../queue';
import { mlQueue } from '../../queue/mlQueue';
import { mediaQueue } from '../../queue/mediaQueue';
import { faceDetectionQueue } from '../../queue/faceDetectionQueue';
import { facialRecognitionQueue } from '../../queue/facialRecognitionQueue';
import { smartSearchQueue } from '../../queue/smartSearchQueue';
import { faceThumbnailQueue } from '../../queue/faceThumbnailQueue';
import { thumbnailQueue } from '../../queue/thumbnailQueue';
import { videoQueue } from '../../queue/videoQueue';
import { query } from '../../config/db';
import { ClusterService } from '../ml/cluster.service';
import { logger } from '../../utils/logger';
import path from 'path';
import fs from 'fs';

function logAudit(level: string, message: string, userId?: string, ipAddress?: string) {
  logger.info(message, { userId, ipAddress });
  try {
    query(
      `INSERT INTO system_logs (level, message, user_id, ip_address) VALUES ($1, $2, $3, $4)`,
      [level, message, userId || null, ipAddress || null]
    ).catch(() => {});
  } catch {}
}

// C-2 Fix: Distributed lock for destructive admin operations.
// Prevents concurrent reset calls (double-click, two admin tabs) from corrupting state.
const ADMIN_RESET_LOCK_KEY = 'admin:reset_lock';
const ADMIN_RESET_LOCK_TTL = 120; // seconds
async function acquireResetLock(reply: any): Promise<boolean> {
  const acquired = await redis.set(ADMIN_RESET_LOCK_KEY, '1', 'EX', ADMIN_RESET_LOCK_TTL, 'NX');
  if (!acquired) {
    reply.status(409).send({ error: 'Another reset operation is already in progress. Please wait and try again.' });
    return false;
  }
  return true;
}
async function releaseResetLock(): Promise<void> {
  await redis.del(ADMIN_RESET_LOCK_KEY);
}

// H-5 Fix: Helper to paginate full-table queries and enqueue jobs in batches.
// Prevents loading the entire media_files table into Node.js heap (OOM risk at scale).
async function enqueuePaginated(
  whereClause: string,
  params: any[],
  enqueue: (row: any) => Promise<void>,
  batchSize = 500
): Promise<void> {
  let offset = 0;
  while (true) {
    const res = await query(
      `SELECT id, folder_path, file_name, mime_type FROM media_files ${whereClause} ORDER BY id LIMIT ${batchSize} OFFSET ${offset}`,
      params
    );
    if (res.rows.length === 0) break;
    for (const row of res.rows) {
      await enqueue(row);
    }
    offset += batchSize;
    if (res.rows.length < batchSize) break;
  }
}

export async function adminRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', requireAuth);
  
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.user?.role !== 'admin' && request.user?.role !== 'super_admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }
  });

  async function verifyAdminPassword(request: any, reply: any) {
    const adminPassword = request.headers['x-admin-password'];
    if (!adminPassword || typeof adminPassword !== 'string') {
      reply.status(401).send({ error: 'Admin password is required to perform this action' });
      return false;
    }
    const adminId = request.user?.id;
    const adminRes = await query('SELECT password_hash FROM users WHERE id = $1', [adminId]);
    if (adminRes.rows.length === 0) {
      reply.status(401).send({ error: 'Admin user not found' });
      return false;
    }
    const isValid = await bcrypt.compare(adminPassword, adminRes.rows[0].password_hash);
    if (!isValid) {
      reply.status(401).send({ error: 'Incorrect admin password' });
      return false;
    }
    return true;
  }

  // Users Management
  fastify.get('/api/admin/users', async (request, reply) => {
    const { rows } = await query(`
      SELECT u.id, u.email, u.name, u.role, u.created_at, 
             COALESCE(json_agg(ufa.folder_path) FILTER (WHERE ufa.folder_path IS NOT NULL), '[]') as folders
      FROM users u
      LEFT JOIN user_folder_access ufa ON u.id = ufa.user_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    return reply.send({ users: rows });
  });

  fastify.post('/api/admin/users', async (request, reply) => {
    if (!(await verifyAdminPassword(request, reply))) return;
    const { email, password, name, role, folders } = request.body as any;
    if (!email || !password || !role) return reply.status(400).send({ error: 'Missing fields' });
    
    const passwordHash = await bcrypt.hash(password, 10);
    try {
      const { rows } = await query(
        'INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
        [email, name || 'Unknown', passwordHash, role]
      );
      const userId = rows[0].id;
      
      if (role !== 'admin' && role !== 'super_admin' && Array.isArray(folders)) {
        for (const f of folders) {
          await query('INSERT INTO user_folder_access (user_id, folder_path) VALUES ($1, $2)', [userId, f]);
        }
      }
      return reply.send({ success: true, userId });
    } catch (e: any) {
      if (e.code === '23505') return reply.status(400).send({ error: 'Email already exists' });
      throw e;
    }
  });

  fastify.put('/api/admin/users/:id', async (request, reply) => {
    if (!(await verifyAdminPassword(request, reply))) return;
    const { id } = request.params as any;
    const { email, name, role, password, folders } = request.body as any;
    
    // Safety check: don't demote the last super_admin
    if (role !== 'super_admin') {
      const userRes = await query('SELECT role FROM users WHERE id = $1', [id]);
      if (userRes.rows.length > 0 && userRes.rows[0].role === 'super_admin') {
        const adminCountRes = await query("SELECT COUNT(*) FROM users WHERE role = 'super_admin'");
        if (parseInt(adminCountRes.rows[0].count) <= 1) {
          return reply.status(400).send({ error: 'Cannot demote the last super admin.' });
        }
      }
    }
    
    let updateQuery = 'UPDATE users SET email = $1, name = $2, role = $3';
    let params: any[] = [email, name, role];
    
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      updateQuery += ', password_hash = $4';
      params.push(hash);
      params.push(id);
      updateQuery += ' WHERE id = $5';
    } else {
      params.push(id);
      updateQuery += ' WHERE id = $4';
    }
    
    await query(updateQuery, params);
    
    if (role !== 'admin' && role !== 'super_admin') {
      await query('DELETE FROM user_folder_access WHERE user_id = $1', [id]);
      if (Array.isArray(folders)) {
        for (const f of folders) {
          await query('INSERT INTO user_folder_access (user_id, folder_path) VALUES ($1, $2)', [id, f]);
        }
      }
    }
    
    return reply.send({ success: true });
  });

  fastify.delete('/api/admin/users/:id', async (request, reply) => {
    if (!(await verifyAdminPassword(request, reply))) return;
    const { id } = request.params as any;
    
    // Safety check: Don't delete the last super_admin
    const userRes = await query('SELECT role FROM users WHERE id = $1', [id]);
    if (userRes.rows.length === 0) {
      return reply.status(404).send({ error: 'User not found' });
    }
    
    if (userRes.rows[0].role === 'super_admin') {
      const adminCountRes = await query("SELECT COUNT(*) FROM users WHERE role = 'super_admin'");
      if (parseInt(adminCountRes.rows[0].count) <= 1) {
        return reply.status(400).send({ error: 'Cannot delete the last super admin.' });
      }
    }
    
    await query('DELETE FROM users WHERE id = $1', [id]);
    return reply.send({ success: true });
  });

  fastify.get('/api/admin/settings', async (request, reply) => {
    const { rows } = await query('SELECT key, value FROM admin_settings');
    const settings: any = {
      maxCpuCores: 2,
      scanInterval: 3600000,
      scanSchedule: { type: 'off' },
      mlConfidenceThreshold: 0.6,
      throttleAuth: 0,
      throttlePublic: 0,
      authMaxLoginTries: 5,
      authTimeoutMinutes: 15,
      authDoubleTimeout: true,
      watermarkText: 'hellomyphotos',
      watermarkOpacity: 0.5,
      watermarkPosition: 'center',
      watermarkEnforceGlobal: false,
      defaultViewMode: 'small-fit',
      defaultSortMode: 'newest',
      defaultFolderViewMode: 'small-grid',
      defaultShareViewMode: 'small-fit',
      defaultShareSortMode: 'newest',
      defaultShareFolderViewMode: 'small-grid'
    };
    
    for (const r of rows) {
      if (r.key === 'max_cpu_cores') settings.maxCpuCores = r.value;
      if (r.key === 'scan_interval') settings.scanInterval = r.value;
      if (r.key === 'scan_schedule') settings.scanSchedule = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
      if (r.key === 'ml_confidence') settings.mlConfidenceThreshold = r.value;
      if (r.key === 'throttle_auth') settings.throttleAuth = r.value;
      if (r.key === 'throttle_public') settings.throttlePublic = r.value;
      if (r.key === 'rate_limit_api') settings.rateLimitApi = r.value;
      if (r.key === 'auth_max_login_tries') settings.authMaxLoginTries = r.value;
      if (r.key === 'auth_timeout_minutes') settings.authTimeoutMinutes = r.value;
      if (r.key === 'auth_double_timeout') settings.authDoubleTimeout = typeof r.value === 'string' ? r.value === 'true' : r.value;
      if (r.key === 'watermark_text') settings.watermarkText = r.value;
      if (r.key === 'watermark_opacity') settings.watermarkOpacity = r.value;
      if (r.key === 'watermark_position') settings.watermarkPosition = r.value;
      if (r.key === 'watermark_enforce_global') settings.watermarkEnforceGlobal = r.value;
      if (r.key === 'default_view_mode') settings.defaultViewMode = r.value;
      if (r.key === 'default_sort_mode') settings.defaultSortMode = r.value;
      if (r.key === 'default_folder_view_mode') settings.defaultFolderViewMode = r.value;
      if (r.key === 'default_share_view_mode') settings.defaultShareViewMode = r.value;
      if (r.key === 'default_share_sort_mode') settings.defaultShareSortMode = r.value;
      if (r.key === 'default_share_folder_view_mode') settings.defaultShareFolderViewMode = r.value;
    }
    
    return reply.send(settings);
  });

  fastify.put('/api/admin/settings', async (request, reply) => {
    const { maxCpuCores, scanInterval, scanSchedule, mlConfidenceThreshold, throttleAuth, throttlePublic, rateLimitApi, authMaxLoginTries, authTimeoutMinutes, authDoubleTimeout, watermarkText, watermarkOpacity, watermarkPosition, watermarkEnforceGlobal, defaultViewMode, defaultSortMode, defaultFolderViewMode, defaultShareViewMode, defaultShareSortMode, defaultShareFolderViewMode } = request.body as any;
    
    const updates = [];
    // H-3 Note: maxCpuCores is persisted here but worker concurrency is set at startup from env vars.
    // Changing this setting takes effect only after a service restart. Consider documenting this in the UI.
    if (maxCpuCores !== undefined) updates.push({ k: 'max_cpu_cores', v: maxCpuCores });
    if (scanInterval !== undefined) updates.push({ k: 'scan_interval', v: scanInterval });
    if (scanSchedule !== undefined) updates.push({ k: 'scan_schedule', v: scanSchedule });
    if (mlConfidenceThreshold !== undefined) updates.push({ k: 'ml_confidence', v: mlConfidenceThreshold });
    if (throttleAuth !== undefined) updates.push({ k: 'throttle_auth', v: throttleAuth });
    if (throttlePublic !== undefined) updates.push({ k: 'throttle_public', v: throttlePublic });
    if (rateLimitApi !== undefined) updates.push({ k: 'rate_limit_api', v: rateLimitApi });
    if (authMaxLoginTries !== undefined) updates.push({ k: 'auth_max_login_tries', v: authMaxLoginTries });
    if (authTimeoutMinutes !== undefined) updates.push({ k: 'auth_timeout_minutes', v: authTimeoutMinutes });
    if (authDoubleTimeout !== undefined) updates.push({ k: 'auth_double_timeout', v: authDoubleTimeout });
    if (watermarkText !== undefined) updates.push({ k: 'watermark_text', v: watermarkText });
    if (watermarkOpacity !== undefined) updates.push({ k: 'watermark_opacity', v: watermarkOpacity });
    if (watermarkPosition !== undefined) updates.push({ k: 'watermark_position', v: watermarkPosition });
    if (watermarkEnforceGlobal !== undefined) updates.push({ k: 'watermark_enforce_global', v: watermarkEnforceGlobal });
    if (defaultViewMode !== undefined) updates.push({ k: 'default_view_mode', v: defaultViewMode });
    if (defaultSortMode !== undefined) updates.push({ k: 'default_sort_mode', v: defaultSortMode });
    if (defaultFolderViewMode !== undefined) updates.push({ k: 'default_folder_view_mode', v: defaultFolderViewMode });
    if (defaultShareViewMode !== undefined) updates.push({ k: 'default_share_view_mode', v: defaultShareViewMode });
    if (defaultShareSortMode !== undefined) updates.push({ k: 'default_share_sort_mode', v: defaultShareSortMode });
    if (defaultShareFolderViewMode !== undefined) updates.push({ k: 'default_share_folder_view_mode', v: defaultShareFolderViewMode });
    
    for (const u of updates) {
      await query(
        'INSERT INTO admin_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
        [u.k, JSON.stringify(u.v)]
      );
    }
    
    logAudit('info', 'Settings updated', (request as any).user?.id, request.ip);
    return reply.send({ success: true });
  });

  fastify.post('/api/admin/rescan', async (request, reply) => {
    // M-4 Fix: Rate-limit rescan to prevent spamming I/O and queue flooding.
    const cooldownKey = 'admin:rescan_cooldown';
    const onCooldown = await redis.exists(cooldownKey);
    if (onCooldown) {
      return reply.status(429).send({ error: 'Rescan was triggered recently. Please wait before triggering again.' });
    }
    await redis.set(cooldownKey, '1', 'EX', 10); // 10-second cooldown
    // Run it asynchronously in the background so we don't block the HTTP request
    ScannerService.scanAllDirectories('').catch(console.error);
    const uid = (request as any).user?.id;
    logAudit('info', 'Full rescan triggered', uid, request.ip);
    return reply.send({ success: true, message: 'Rescan initiated in the background' });
  });

  fastify.post('/api/admin/rescan-faces', async (request, reply) => {
    if (!(await acquireResetLock(reply))) return;
    try {
      // 1. Wipe out existing face embeddings
      await query(`TRUNCATE TABLE face_embeddings`);

      // 2. Clear orphaned face thumbnail cache on disk
      const cacheRoot = path.resolve(process.env.CACHE_ROOT || path.resolve(process.cwd(), '../volumes/cache_rw'));
      await fs.promises.rm(path.join(cacheRoot, 'faces'), { recursive: true, force: true });
      await fs.promises.mkdir(path.join(cacheRoot, 'faces'), { recursive: true });

      // 3. Clean stale face thumbnail queue jobs
      await faceThumbnailQueue.clean(0, 10000, 'completed');
      await faceThumbnailQueue.clean(0, 10000, 'failed');

      // 4. Queue every image file for face detection again (paginated to avoid OOM)
      const mediaRoot = process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro');
      await enqueuePaginated(`WHERE mime_type LIKE 'image/%'`, [], async (row) => {
        const fullPath = path.resolve(mediaRoot, row.folder_path, row.file_name);
        await faceDetectionQueue.add('detect-faces', { mediaId: row.id, fullPath, mimeType: row.mime_type });
      });
    } finally {
      await releaseResetLock();
    }
    return reply.send({ success: true, message: 'Face data reset, thumbnails cleared, re-detection initiated!' });
  });

  fastify.post('/api/admin/rescan-exif', async (request, reply) => {
    if (!(await acquireResetLock(reply))) return;
    try {
      // Queue every image file for EXIF reprocessing (paginated to avoid OOM)
      const mediaRoot = process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro');
      await enqueuePaginated(`WHERE mime_type LIKE 'image/%'`, [], async (row) => {
        await mediaQueue.add('process-media', {
          mediaId: row.id,
          fullPath: path.resolve(mediaRoot, row.folder_path, row.file_name),
          mimeType: row.mime_type
        });
      });
    } finally {
      await releaseResetLock();
    }
    return reply.send({ success: true, message: 'EXIF extraction initiated in the background' });
  });

  fastify.post('/api/admin/reset-index', async (request, reply) => {
    // C-2 Fix: Acquire distributed lock to prevent concurrent destructive operations.
    if (!(await acquireResetLock(reply))) return;
    try {
      // M-3 Fix: All truncates in one atomic PostgreSQL statement.
      // Using query() (not pool.connect()) so ensureSchema() runs first and all tables exist.
      // NOTE: 'folders' table does NOT exist — the real tables are folder_settings and shared_folders.
      // shared_folders has FKs to media_files and people, so it must be included or CASCADE handles it.
      await query(`
        TRUNCATE TABLE 
          smart_search_embeddings,
          face_embeddings,
          media_analytics,
          shared_folders,
          folder_settings,
          media_files
        RESTART IDENTITY CASCADE
      `);
      // people uses UUID PKs (no sequences), so DELETE is correct here
      await query(`DELETE FROM people`);

      // Clear Redis analytics cache so the cron job doesn't try to flush stats for wiped media files (which causes a foreign key error)
      const analyticsKeys = await redis.keys('analytics:*');
      if (analyticsKeys.length > 0) {
        await redis.del(...analyticsKeys);
      }

      const cacheRoot = path.resolve(process.env.CACHE_ROOT || path.resolve(process.cwd(), '../volumes/cache_rw'));
      // M-5 Fix: Use async fs.promises.rm to avoid blocking the event loop on large cache dirs.
      await fs.promises.rm(path.join(cacheRoot, '1080p'), { recursive: true, force: true });
      await fs.promises.rm(path.join(cacheRoot, '480p'), { recursive: true, force: true });
      // Also clear the faces/ thumbnail cache — the dashboard reads completed count from disk files,
      // so this must be wiped alongside the DB to avoid showing stale face thumbnail counts.
      await fs.promises.rm(path.join(cacheRoot, 'faces'), { recursive: true, force: true });
      await fs.promises.mkdir(path.join(cacheRoot, '1080p'), { recursive: true });
      await fs.promises.mkdir(path.join(cacheRoot, '480p'), { recursive: true });
      await fs.promises.mkdir(path.join(cacheRoot, 'faces'), { recursive: true });


      for (const q of Object.values(allQueues)) {
        await q.pause();
        await q.drain(true);
        await q.clean(0, 10000, 'completed');
        await q.clean(0, 10000, 'failed');
        await q.clean(0, 10000, 'active');
        await q.clean(0, 10000, 'wait');
        await q.clean(0, 10000, 'delayed');
        await q.resume();
      }

      ScannerService.scanAllDirectories('').catch(console.error);
    } finally {
      await releaseResetLock();
    }
    return reply.send({ success: true, message: 'Index wiped and rescan initiated in the background' });
  });


  fastify.post('/api/admin/reset-smart-search', async (request, reply) => {
    if (!(await acquireResetLock(reply))) return;
    try {
      await query(`TRUNCATE TABLE smart_search_embeddings`);
      await query(`UPDATE media_files SET clip_embedding = NULL`);

      await allQueues['smart-search'].clean(0, 10000, 'completed');
      await allQueues['smart-search'].clean(0, 10000, 'failed');

      // H-5 Fix: Paginated enqueue to avoid OOM
      const mediaRoot = process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro');
      await enqueuePaginated(`WHERE mime_type LIKE 'image/%' OR mime_type LIKE 'video/%'`, [], async (row) => {
        const fullPath = path.resolve(mediaRoot, row.folder_path, row.file_name);
        await smartSearchQueue.add('generate-smart-search', { mediaId: row.id, fullPath, mimeType: row.mime_type });
      });
    } finally {
      await releaseResetLock();
    }
    return reply.send({ success: true, message: 'Smart search reset initiated in the background' });
  });

  fastify.post('/api/admin/reset-exif', async (request, reply) => {
    if (!(await acquireResetLock(reply))) return;
    try {
      await query(`UPDATE media_files SET blurhash = NULL, exif_json = NULL`);

      const cacheRoot = path.resolve(process.env.CACHE_ROOT || path.resolve(process.cwd(), '../volumes/cache_rw'));
      // M-5 Fix: async rm to avoid blocking the event loop
      await fs.promises.rm(path.join(cacheRoot, '1080p'), { recursive: true, force: true });
      await fs.promises.rm(path.join(cacheRoot, '480p'), { recursive: true, force: true });
      await fs.promises.mkdir(path.join(cacheRoot, '1080p'), { recursive: true });
      await fs.promises.mkdir(path.join(cacheRoot, '480p'), { recursive: true });

      await allQueues['metadata'].clean(0, 10000, 'completed');
      await allQueues['metadata'].clean(0, 10000, 'failed');
      await allQueues['thumbnail'].clean(0, 10000, 'completed');
      await allQueues['thumbnail'].clean(0, 10000, 'failed');

      // H-5 Fix: Paginated enqueue to avoid OOM
      const mediaRoot = process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro');
      await enqueuePaginated(`WHERE mime_type LIKE 'image/%'`, [], async (row) => {
        await mediaQueue.add('process-media', {
          mediaId: row.id,
          fullPath: path.resolve(mediaRoot, row.folder_path, row.file_name),
          mimeType: row.mime_type
        });
      });
    } finally {
      await releaseResetLock();
    }
    return reply.send({ success: true, message: 'Media/EXIF reset initiated in the background' });
  });

  fastify.post('/api/admin/reset-thumbnails', async (request, reply) => {
    if (!(await acquireResetLock(reply))) return;
    try {
      await query(`UPDATE media_files SET blurhash = NULL, has_1080p = false, has_480p = false WHERE mime_type LIKE 'image/%'`);

      await allQueues['thumbnail'].clean(0, 10000, 'completed');
      await allQueues['thumbnail'].clean(0, 10000, 'failed');

      const mediaRoot = process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro');
      await enqueuePaginated(`WHERE mime_type LIKE 'image/%'`, [], async (row) => {
        await thumbnailQueue.add('generate-thumbnail', {
          mediaId: row.id,
          fullPath: path.resolve(mediaRoot, row.folder_path, row.file_name),
          mimeType: row.mime_type,
          skipCascade: true
        });
      });
    } finally {
      await releaseResetLock();
    }
    return reply.send({ success: true, message: 'Image thumbnail reset initiated in the background' });
  });

  fastify.post('/api/admin/reset-videos', async (request, reply) => {
    if (!(await acquireResetLock(reply))) return;
    try {
      await query(`UPDATE media_files SET blurhash = NULL, has_1080p = false, has_480p = false WHERE mime_type LIKE 'video/%'`);

      await allQueues['video'].clean(0, 10000, 'completed');
      await allQueues['video'].clean(0, 10000, 'failed');

      const mediaRoot = process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro');
      await enqueuePaginated(`WHERE mime_type LIKE 'video/%'`, [], async (row) => {
        await videoQueue.add('generate-video-proxy', {
          mediaId: row.id,
          fullPath: path.resolve(mediaRoot, row.folder_path, row.file_name),
          mimeType: row.mime_type,
          skipCascade: true
        });
      });
    } finally {
      await releaseResetLock();
    }
    return reply.send({ success: true, message: 'Video reset initiated in the background' });
  });

  fastify.post('/api/admin/reset-faces', async (request, reply) => {
    if (!(await acquireResetLock(reply))) return;
    try {
      await query(`TRUNCATE TABLE face_embeddings CASCADE`);
      await query(`DELETE FROM people`);

      await allQueues['face-detection'].clean(0, 10000, 'completed');
      await allQueues['face-detection'].clean(0, 10000, 'failed');
      await allQueues['facial-recognition'].clean(0, 10000, 'completed');
      await allQueues['facial-recognition'].clean(0, 10000, 'failed');
      await allQueues['face-thumbnail'].clean(0, 10000, 'completed');
      await allQueues['face-thumbnail'].clean(0, 10000, 'failed');

      // H-5 Fix: Paginated enqueue
      const mediaRoot = process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro');
      await enqueuePaginated(`WHERE mime_type LIKE 'image/%'`, [], async (row) => {
        const fullPath = path.resolve(mediaRoot, row.folder_path, row.file_name);
        await faceDetectionQueue.add('detect-faces', { mediaId: row.id, fullPath, mimeType: row.mime_type });
      });
    } finally {
      await releaseResetLock();
    }
    return reply.send({ success: true, message: 'Face reset initiated in the background' });
  });

  fastify.post('/api/admin/recluster-faces', async (request, reply) => {
    try {
      await ClusterService.reclusterFaces();
      return reply.send({ success: true, message: 'Faces reclustered successfully' });
    } catch (e: any) {
      return reply.status(500).send({ error: e.message });
    }
  });

  fastify.post('/api/admin/clear-face-thumbnails', async (request, reply) => {
    if (!(await acquireResetLock(reply))) return;
    try {
      const cacheRoot = path.resolve(process.env.CACHE_ROOT || path.resolve(process.cwd(), '../volumes/cache_rw'));
      // M-5 Fix: async rm
      await fs.promises.rm(path.join(cacheRoot, 'faces'), { recursive: true, force: true });
      await fs.promises.mkdir(path.join(cacheRoot, 'faces'), { recursive: true });

      await faceThumbnailQueue.clean(0, 10000, 'completed');
      await faceThumbnailQueue.clean(0, 10000, 'failed');

      const result = await query(`SELECT DISTINCT media_id FROM face_embeddings`);
      for (const row of result.rows) {
        await faceThumbnailQueue.add('generate-face-thumbnails', { mediaId: row.media_id });
      }
    } finally {
      await releaseResetLock();
    }
    return reply.send({ success: true, message: 'Face thumbnail cache cleared and regeneration queued' });
  });

  fastify.get('/api/admin/logs', async (request, reply) => {
    const { archive, lines } = request.query as any;
    try {
      let content: string;
      if (archive) {
        content = await logger.readArchive(archive);
      } else {
        content = await logger.readLatest(parseInt(lines || '500', 10));
      }
      const archives = await logger.listArchives();
      const parsed = content.split('\n').filter(Boolean).reverse();
      return reply.send({ logs: parsed, archives });
    } catch (e: any) {
      return reply.status(500).send({ error: e.message });
    }
  });

  fastify.get('/api/admin/analytics', async (request, reply) => {
    try {
      const photosStats = await query(`SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as size FROM media_files WHERE mime_type LIKE 'image/%'`);
      const videosStats = await query(`SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as size FROM media_files WHERE mime_type LIKE 'video/%'`);
      const visitsStats = await query(`SELECT COUNT(*) as count FROM media_analytics`);
      
      const topShares = await query(`
        SELECT 
          COALESCE(s.folder_path, s.media_id::text) as folder_path,
          COUNT(*) as views
        FROM media_analytics a
        LEFT JOIN shared_folders s ON a.share_token = s.share_token
        WHERE a.share_token IS NOT NULL
        GROUP BY COALESCE(s.folder_path, s.media_id::text)
        ORDER BY views DESC
        LIMIT 10
      `);

      const topMedia = await query(`
        SELECT 
          m.file_name,
          m.folder_path,
          COUNT(*) as views
        FROM media_analytics a
        JOIN media_files m ON a.media_id = m.id
        WHERE a.media_id IS NOT NULL
        GROUP BY m.id, m.file_name, m.folder_path
        ORDER BY views DESC
        LIMIT 10
      `);

      return reply.send({
        stats: {
          photos: {
            count: parseInt(photosStats.rows[0].count),
            size: parseInt(photosStats.rows[0].size)
          },
          videos: {
            count: parseInt(videosStats.rows[0].count),
            size: parseInt(videosStats.rows[0].size)
          },
          visits: parseInt(visitsStats.rows[0].count)
        },
        topShares: topShares.rows,
        topMedia: topMedia.rows
      });
    } catch (e: any) {
      request.log.error(e);
      return reply.status(500).send({ error: e.message });
    }
  });

  // Active Shares Management
  fastify.get('/api/admin/shares', async (request, reply) => {
    try {
      const { rows } = await query(`
        SELECT s.*, 
               u.email as creator_email,
               (SELECT COUNT(*) FROM media_analytics a WHERE a.share_token = s.share_token AND a.action_type = 'view_shared_link') as views,
               (SELECT COUNT(*) FROM media_analytics a WHERE a.share_token = s.share_token AND a.action_type = 'download_shared_link') as downloads
        FROM shared_folders s
        LEFT JOIN users u ON s.created_by = u.id
        ORDER BY s.created_at DESC
      `);
      return reply.send({ shares: rows });
    } catch (e: any) {
      request.log.error(e);
      return reply.status(500).send({ error: e.message });
    }
  });

  fastify.put('/api/admin/shares/:token', async (request, reply) => {
    const { token } = request.params as any;
    const { is_active, expires_at, allow_download_images, allow_download_folder, watermark_enabled } = request.body as any;
    try {
      await query(`
        UPDATE shared_folders 
        SET is_active = COALESCE($1, is_active),
            expires_at = $2,
            allow_download_images = COALESCE($3, allow_download_images),
            allow_download_folder = COALESCE($4, allow_download_folder),
            watermark_enabled = COALESCE($5, watermark_enabled)
        WHERE share_token = $6
      `, [is_active, expires_at, allow_download_images, allow_download_folder, watermark_enabled, token]);
      return reply.send({ success: true });
    } catch (e: any) {
      request.log.error(e);
      return reply.status(500).send({ error: e.message });
    }
  });

  fastify.delete('/api/admin/shares/:token', async (request, reply) => {
    const { token } = request.params as any;
    try {
      await query('DELETE FROM shared_folders WHERE share_token = $1', [token]);
      return reply.send({ success: true });
    } catch (e: any) {
      request.log.error(e);
      return reply.status(500).send({ error: e.message });
    }
  });

  fastify.post('/api/admin/faces/merge', async (request, reply) => {
    const body = (request.body || {}) as any;
    const targetPersonId = body.targetPersonId;
    const sourcePersonIds = Array.isArray(body.sourcePersonIds) 
      ? body.sourcePersonIds 
      : (body.sourcePersonId ? [body.sourcePersonId] : []);

    if (!targetPersonId || !sourcePersonIds.length) {
      return reply.status(400).send({ error: 'Missing target or source person IDs' });
    }
    
    try {
      await query(
        `UPDATE face_embeddings SET person_id = $1 WHERE person_id = ANY($2)`,
        [targetPersonId, sourcePersonIds]
      );
      
      return reply.send({ success: true, message: `Merged ${sourcePersonIds.length} face clusters into ${targetPersonId}` });
    } catch (e: any) {
      return reply.status(500).send({ error: e.message });
    }
  });

}
