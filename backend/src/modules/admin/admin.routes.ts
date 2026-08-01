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
import { normalizeReferrer, SPAM_DOMAINS, SPAM_SUBSTRINGS } from '../../utils/referrer';
import path from 'path';
import fs from 'fs';

const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || path.resolve(process.cwd(), '../volumes/cache_rw'));

// Walk a directory recursively and sum the size of every file it contains.
async function getDirSize(dir: string): Promise<number> {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try { total += (await fs.promises.stat(full)).size; } catch {}
      }
    }
  }
  return total;
}

// Per top-level subfolder sizes of the cache directory (480p, 1080p, faces, transcodes, ...)
async function getCacheBreakdown(root: string): Promise<{ name: string; bytes: number }[]> {
  let entries;
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: { name: string; bytes: number }[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push({ name: entry.name, bytes: await getDirSize(full) });
    } else if (entry.isFile()) {
      try { out.push({ name: entry.name, bytes: (await fs.promises.stat(full)).size }); } catch {}
    }
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

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
      throttleAuthGlobal: 0,
      throttlePublicGlobal: 0,
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
      defaultSortMode: 'oldest',
      defaultFolderViewMode: 'small-grid',
      defaultShareViewMode: 'small-fit',
      defaultShareSortMode: 'oldest',
      defaultShareFolderViewMode: 'small-grid',
      analyticsFilterBots: false,
      analyticsFilterSpam: false
    };
    
    for (const r of rows) {
      if (r.key === 'max_cpu_cores') settings.maxCpuCores = r.value;
      if (r.key === 'scan_interval') settings.scanInterval = r.value;
      if (r.key === 'scan_schedule') settings.scanSchedule = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
      if (r.key === 'ml_confidence') settings.mlConfidenceThreshold = r.value;
      if (r.key === 'throttle_auth_global') settings.throttleAuthGlobal = r.value;
      if (r.key === 'throttle_public_global') settings.throttlePublicGlobal = r.value;
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
      if (r.key === 'analytics_filter_bots') settings.analyticsFilterBots = typeof r.value === 'string' ? r.value === 'true' : r.value;
      if (r.key === 'analytics_filter_spam') settings.analyticsFilterSpam = typeof r.value === 'string' ? r.value === 'true' : r.value;
    }
    
    return reply.send(settings);
  });

  fastify.put('/api/admin/settings', async (request, reply) => {
    const { maxCpuCores, scanInterval, scanSchedule, mlConfidenceThreshold, throttleAuthGlobal, throttlePublicGlobal, throttleAuth, throttlePublic, rateLimitApi, authMaxLoginTries, authTimeoutMinutes, authDoubleTimeout, watermarkText, watermarkOpacity, watermarkPosition, watermarkEnforceGlobal, defaultViewMode, defaultSortMode, defaultFolderViewMode, defaultShareViewMode, defaultShareSortMode, defaultShareFolderViewMode, analyticsFilterBots, analyticsFilterSpam } = request.body as any;
    
    const updates = [];
    // H-3 Note: maxCpuCores is persisted here but worker concurrency is set at startup from env vars.
    // Changing this setting takes effect only after a service restart. Consider documenting this in the UI.
    if (maxCpuCores !== undefined) updates.push({ k: 'max_cpu_cores', v: maxCpuCores });
    if (scanInterval !== undefined) updates.push({ k: 'scan_interval', v: scanInterval });
    if (scanSchedule !== undefined) updates.push({ k: 'scan_schedule', v: scanSchedule });
    if (mlConfidenceThreshold !== undefined) updates.push({ k: 'ml_confidence', v: mlConfidenceThreshold });
    if (throttleAuthGlobal !== undefined) updates.push({ k: 'throttle_auth_global', v: throttleAuthGlobal });
    if (throttlePublicGlobal !== undefined) updates.push({ k: 'throttle_public_global', v: throttlePublicGlobal });
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
    if (analyticsFilterBots !== undefined) updates.push({ k: 'analytics_filter_bots', v: analyticsFilterBots });
    if (analyticsFilterSpam !== undefined) updates.push({ k: 'analytics_filter_spam', v: analyticsFilterSpam });
    
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

      // Scope: 'all' (global) or 'shares' (shared links only)
      const { scope } = request.query as any;
      const shareOnly = scope === 'shares';
      const mediaScope = shareOnly ? ' AND share_token IS NOT NULL' : '';
      const mediaWhere = shareOnly ? ' WHERE share_token IS NOT NULL' : '';

      const visitsStats = await query(`SELECT COUNT(*) as count FROM media_analytics${mediaWhere}`);

      // Analytics filtering preferences (bot traffic / referrer spam)
      const prefRes = await query(`SELECT key, value FROM admin_settings WHERE key IN ('analytics_filter_bots', 'analytics_filter_spam')`);
      const pref = (key: string, def: boolean) => {
        const row = prefRes.rows.find((r: any) => r.key === key);
        if (!row) return def;
        return typeof row.value === 'string' ? row.value === 'true' : !!row.value;
      };
      const filterBots = pref('analytics_filter_bots', false);
      const filterSpam = pref('analytics_filter_spam', false);

      // Build a reusable WHERE clause for visitor-based queries
      const visitConds: string[] = [];
      const visitParams: any[] = [];
      const P = (v: any) => { visitParams.push(v); return `$${visitParams.length}`; };
      if (filterBots) visitConds.push(`device_type <> ${P('bot')}`);
      if (shareOnly) visitConds.push(`share_token IS NOT NULL`);
      if (filterSpam) {
        const spamConds: string[] = [];
        for (const d of SPAM_DOMAINS) spamConds.push(`referrer ILIKE ${P('%' + d + '%')}`);
        for (const s of SPAM_SUBSTRINGS) spamConds.push(`referrer ILIKE ${P('%' + s + '%')}`);
        visitConds.push(`(referrer IS NULL OR NOT (${spamConds.join(' OR ')}))`);
      }
      const visitWhere = visitConds.length > 0 ? `WHERE ${visitConds.join(' AND ')}` : '';

      const downloadsFileWhere = `${visitWhere}${visitWhere ? ' AND' : ' WHERE'} a.action_type = 'download'`;
      const downloadsFolderWhere = `${visitWhere}${visitWhere ? ' AND' : ' WHERE'} action_type = 'download_folder'`;
      const downloadsByDayWhere = `${visitWhere}${visitWhere ? ' AND' : ' WHERE'} action_type = 'download' AND created_at > NOW() - INTERVAL '30 days'`;

      const [
        visitorStats,
        osStats,
        browserStats,
        deviceStats,
        timeline,
        topIPs,
        peakHours,
        rawReferrers,
        dbSizeRes,
        bandwidthTotal,
        bandwidthByDay,
        topBandwidthMedia,
        topBandwidthShares,
        popularFolders,
        shareConversion,
        expiringShares,
        blockedStats,
        blockedRecent,
        folderBreakdown,
        viewsByDay,
        dbTableSizes,
        downloadsTotal,
        downloadsByDay,
        topFileDownloads,
        topFolderDownloads
      ] = await Promise.all([
        query(`SELECT COUNT(*) as total, COUNT(DISTINCT ip_hash) as unique_visitors FROM analytics_visits ${visitWhere}`, visitParams),
        query(`SELECT COALESCE(NULLIF(os, ''), 'Unknown') as name, COUNT(*) as count FROM analytics_visits ${visitWhere} GROUP BY name ORDER BY count DESC`, visitParams),
        query(`SELECT COALESCE(NULLIF(browser, ''), 'Unknown') as name, COUNT(*) as count FROM analytics_visits ${visitWhere} GROUP BY name ORDER BY count DESC`, visitParams),
        query(`SELECT COALESCE(NULLIF(device_type, ''), 'unknown') as name, COUNT(*) as count FROM analytics_visits ${visitWhere} GROUP BY name ORDER BY count DESC`, visitParams),
        query(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, COUNT(*) as count FROM analytics_visits ${visitWhere ? visitWhere + ' AND' : 'WHERE'} created_at > NOW() - INTERVAL '30 days' GROUP BY day ORDER BY day`, visitParams),
        query(`SELECT ip, COUNT(*) as visits FROM analytics_visits ${visitWhere} GROUP BY ip ORDER BY visits DESC LIMIT 100`, visitParams),
        query(`SELECT EXTRACT(HOUR FROM created_at)::int as hour, COUNT(*) as count FROM analytics_visits ${visitWhere} GROUP BY hour ORDER BY hour`, visitParams),
        query(`SELECT referrer, COUNT(*) as count FROM analytics_visits ${visitWhere} GROUP BY referrer ORDER BY count DESC`, visitParams),
        query(`SELECT pg_database_size(current_database()) as size`),
        query(`SELECT COALESCE(SUM(bytes_served), 0) as bytes FROM media_analytics${mediaWhere}`),
        query(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, COALESCE(SUM(bytes_served), 0) as bytes FROM media_analytics WHERE created_at > NOW() - INTERVAL '30 days' ${mediaScope} GROUP BY day ORDER BY day`),
        query(`SELECT m.id, m.file_name, m.folder_path, COALESCE(SUM(a.bytes_served), 0) as bytes, COUNT(*) as views FROM media_analytics a JOIN media_files m ON a.media_id = m.id WHERE a.media_id IS NOT NULL ${mediaScope} GROUP BY m.id, m.file_name, m.folder_path ORDER BY bytes DESC LIMIT 500`),
        query(`SELECT COALESCE(s.folder_path, s.media_id::text, a.share_token) as label, a.share_token, COALESCE(SUM(a.bytes_served), 0) as bytes, COUNT(*) as views FROM media_analytics a LEFT JOIN shared_folders s ON a.share_token = s.share_token WHERE a.share_token IS NOT NULL GROUP BY label, a.share_token ORDER BY bytes DESC LIMIT 500`),
        query(`SELECT m.folder_path, COUNT(*) as views FROM media_analytics a JOIN media_files m ON a.media_id = m.id WHERE a.media_id IS NOT NULL ${mediaScope} GROUP BY m.folder_path ORDER BY views DESC LIMIT 500`),
        query(`SELECT COALESCE(s.folder_path, s.media_id::text, v.share_token) as label, v.share_token, COUNT(*) as visits, COUNT(DISTINCT v.ip_hash) as unique_visitors, (SELECT COUNT(*) FROM media_analytics a WHERE a.share_token = v.share_token) as media_views FROM analytics_visits v LEFT JOIN shared_folders s ON v.share_token = s.share_token WHERE v.share_token IS NOT NULL GROUP BY label, v.share_token ORDER BY unique_visitors DESC LIMIT 500`),
        query(`SELECT s.share_token, s.folder_path, s.media_id, s.expires_at, s.is_active, u.email as creator_email FROM shared_folders s LEFT JOIN users u ON s.created_by = u.id WHERE s.is_active = true AND s.expires_at IS NOT NULL AND s.expires_at < NOW() + INTERVAL '7 days' ORDER BY s.expires_at ASC`),
        query(`SELECT COUNT(*) as count FROM analytics_visits WHERE action_type IN ('blocked_access', 'not_found')`),
        query(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, COUNT(*) as count FROM analytics_visits WHERE action_type IN ('blocked_access', 'not_found') AND created_at > NOW() - INTERVAL '7 days' GROUP BY day ORDER BY day`),
        query(`SELECT folder_path, COUNT(*) FILTER (WHERE mime_type LIKE 'image/%') as photos, COUNT(*) FILTER (WHERE mime_type LIKE 'video/%') as videos FROM media_files GROUP BY folder_path ORDER BY (COUNT(*) FILTER (WHERE mime_type LIKE 'image/%') + COUNT(*) FILTER (WHERE mime_type LIKE 'video/%')) DESC LIMIT 500`),
        query(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, COUNT(*) as count FROM media_analytics WHERE created_at > NOW() - INTERVAL '30 days' ${mediaScope} GROUP BY day ORDER BY day`),
        query(`SELECT c.relname as name, pg_total_relation_size(c.oid) as bytes FROM pg_class c WHERE c.relkind IN ('r', 'm') AND c.relnamespace = 'public'::regnamespace ORDER BY bytes DESC LIMIT 20`),
        query(`SELECT COUNT(*) as count FROM analytics_visits ${visitWhere}${visitWhere ? ' AND' : ' WHERE'} action_type IN ('download', 'download_folder')`, visitParams),
        query(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, COUNT(*) as count FROM analytics_visits ${downloadsByDayWhere} GROUP BY day ORDER BY day`, visitParams),
        query(`SELECT m.id, m.file_name, m.folder_path, COUNT(*) as downloads FROM analytics_visits a JOIN media_files m ON a.media_id = m.id ${downloadsFileWhere} GROUP BY m.id, m.file_name, m.folder_path ORDER BY downloads DESC LIMIT 500`, visitParams),
        query(`SELECT folder_path, COUNT(*) as downloads FROM analytics_visits ${downloadsFolderWhere} GROUP BY folder_path ORDER BY downloads DESC LIMIT 500`, visitParams)
      ]);

      const cacheSize = await getDirSize(CACHE_ROOT);
      const cacheBreakdown = await getCacheBreakdown(CACHE_ROOT);

      const toInt = (v: any) => parseInt(v, 10);

      // Normalize referrers into source buckets (Direct, domain, ...) and drop spam
      const selfHost = (() => {
        try { return new URL(process.env.APP_DOMAIN || '').hostname; } catch { return ''; }
      })();
      const refMap = new Map<string, number>();
      for (const r of rawReferrers.rows) {
        const { name, spam } = normalizeReferrer(r.referrer, selfHost);
        if (filterSpam && spam) continue;
        refMap.set(name, (refMap.get(name) || 0) + toInt(r.count));
      }
      const topReferrers = [...refMap.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 500);

      const topShares = await query(`
        SELECT 
          COALESCE(s.folder_path, s.media_id::text) as folder_path,
          COUNT(*) as views
        FROM media_analytics a
        LEFT JOIN shared_folders s ON a.share_token = s.share_token
        WHERE a.share_token IS NOT NULL
        GROUP BY COALESCE(s.folder_path, s.media_id::text)
        ORDER BY views DESC
        LIMIT 500
      `);

      const topMedia = await query(`
        SELECT 
          m.id,
          m.file_name,
          m.folder_path,
          COUNT(*) as views
        FROM media_analytics a
        JOIN media_files m ON a.media_id = m.id
        WHERE a.media_id IS NOT NULL AND a.share_token IS NOT NULL
        GROUP BY m.id, m.file_name, m.folder_path
        ORDER BY views DESC
        LIMIT 500
      `);

      const normBreakdown = (rows: any[]) => rows.map(r => ({ name: r.name, count: toInt(r.count) }));
      const normIPs = (rows: any[]) => rows.map(r => ({ ip: r.ip, visits: toInt(r.visits) }));

      return reply.send({
        filters: {
          filterBots,
          filterSpam
        },
        stats: {
          photos: {
            count: toInt(photosStats.rows[0].count),
            size: toInt(photosStats.rows[0].size)
          },
          videos: {
            count: toInt(videosStats.rows[0].count),
            size: toInt(videosStats.rows[0].size)
          },
          visits: toInt(visitsStats.rows[0].count),
          visitors: {
            total: toInt(visitorStats.rows[0].total),
            unique: toInt(visitorStats.rows[0].unique_visitors)
          },
          bandwidth: toInt(bandwidthTotal.rows[0].bytes),
          downloads: toInt(downloadsTotal.rows[0].count),
          cache: { size: cacheSize },
          db: { size: toInt(dbSizeRes.rows[0].size) }
        },
        topShares: topShares.rows.map(r => ({ folder_path: r.folder_path, views: toInt(r.views) })),
        topMedia: topMedia.rows.map(r => ({ id: r.id, file_name: r.file_name, folder_path: r.folder_path, views: toInt(r.views) })),
        osBreakdown: normBreakdown(osStats.rows),
        browserBreakdown: normBreakdown(browserStats.rows),
        deviceBreakdown: normBreakdown(deviceStats.rows),
        timeline: timeline.rows.map(r => ({ day: r.day, count: toInt(r.count) })),
        topIPs: normIPs(topIPs.rows),
        topReferrers,
        peakHours: peakHours.rows.map(r => ({ hour: toInt(r.hour), count: toInt(r.count) })),
        bandwidthByDay: bandwidthByDay.rows.map(r => ({ day: r.day, bytes: toInt(r.bytes) })),
        topBandwidthMedia: topBandwidthMedia.rows.map(r => ({ id: r.id, file_name: r.file_name, folder_path: r.folder_path, bytes: toInt(r.bytes), views: toInt(r.views) })),
        topBandwidthShares: topBandwidthShares.rows.map(r => ({ label: r.label, share_token: r.share_token, bytes: toInt(r.bytes), views: toInt(r.views) })),
        popularFolders: popularFolders.rows.map(r => ({ folder_path: r.folder_path, views: toInt(r.views) })),
        shareConversion: shareConversion.rows.map(r => ({ label: r.label, share_token: r.share_token, visits: toInt(r.visits), unique_visitors: toInt(r.unique_visitors), media_views: toInt(r.media_views) })),
        expiringShares: expiringShares.rows,
        blockedAttempts: {
          total: toInt(blockedStats.rows[0].count),
          recent: blockedRecent.rows.map(r => ({ day: r.day, count: toInt(r.count) }))
        },
        folderBreakdown: folderBreakdown.rows.map(r => ({ folder_path: r.folder_path, photos: toInt(r.photos), videos: toInt(r.videos) })),
        viewsByDay: viewsByDay.rows.map(r => ({ day: r.day, count: toInt(r.count) })),
        cacheBreakdown: cacheBreakdown.map(r => ({ name: r.name, bytes: r.bytes })),
        dbTableSizes: dbTableSizes.rows.map(r => ({ name: r.name, bytes: toInt(r.bytes) })),
        downloadsByDay: downloadsByDay.rows.map(r => ({ day: r.day, count: toInt(r.count) })),
        topFileDownloads: topFileDownloads.rows.map(r => ({ id: r.id, file_name: r.file_name, folder_path: r.folder_path, downloads: toInt(r.downloads) })),
        topFolderDownloads: topFolderDownloads.rows.map(r => ({ folder_path: r.folder_path, downloads: toInt(r.downloads) }))
      });
    } catch (e: any) {
      request.log.error(e);
      return reply.status(500).send({ error: e.message });
    }
  });

  // Folder-scoped analytics. Mirrors the global analytics response shape but filters
  // everything to a single folder (optionally including its descendants) and lets the
  // caller narrow to shared-link traffic, or to one specific shared link.
  fastify.get('/api/admin/analytics/folder', async (request, reply) => {
    try {
      const { path: folderPath = '', includeDescendants = '0', scope = 'all', shareToken = '' } = request.query as any;
      const descend = includeDescendants === '1';
      const shareOnly = scope === 'shares';

      // Analytics filtering preferences (bot traffic / referrer spam) - same as global
      const prefRes = await query(`SELECT key, value FROM admin_settings WHERE key IN ('analytics_filter_bots', 'analytics_filter_spam')`);
      const pref = (key: string, def: boolean) => {
        const row = prefRes.rows.find((r: any) => r.key === key);
        if (!row) return def;
        return typeof row.value === 'string' ? row.value === 'true' : !!row.value;
      };
      const filterBots = pref('analytics_filter_bots', false);
      const filterSpam = pref('analytics_filter_spam', false);

      // Each query builds its own params (contiguous, starting at $1) so Postgres can
      // infer parameter types; unused placeholders in the bind array would error.
      const run = (build: (p: (v: any) => string) => string) => {
        const params: any[] = [];
        const p = (v: any) => { params.push(v); return `$${params.length}`; };
        return query(build(p), params);
      };

      const folderCond = (col: string, p: (v: any) => string) =>
        descend
          ? `(${col} = ${p(folderPath)} OR ${col} LIKE ${p(folderPath + '/%')})`
          : `${col} = ${p(folderPath)}`;

      const shareCond = (col: string, p: (v: any) => string) => {
        if (!shareOnly) return '';
        return shareToken ? `${col} = ${p(shareToken)}` : `${col} IS NOT NULL`;
      };

      // Visitor scope: media visited inside the folder, plus folder (zip) downloads of the folder.
      const visitorFolder = (p: (v: any) => string) =>
        `((a.media_id IS NOT NULL AND EXISTS (SELECT 1 FROM media_files m WHERE m.id = a.media_id AND ${folderCond('m.folder_path', p)})) OR (a.action_type = 'download_folder' AND ${folderCond('a.folder_path', p)}))`;
      const botCond = (p: (v: any) => string) => (filterBots ? `a.device_type <> ${p('bot')}` : '');
      const spamCond = (p: (v: any) => string) => {
        if (!filterSpam) return '';
        const spamConds: string[] = [];
        for (const d of SPAM_DOMAINS) spamConds.push(`a.referrer ILIKE ${p('%' + d + '%')}`);
        for (const s of SPAM_SUBSTRINGS) spamConds.push(`a.referrer ILIKE ${p('%' + s + '%')}`);
        return `(a.referrer IS NULL OR NOT (${spamConds.join(' OR ')}))`;
      };
      const visitorWhere = (p: (v: any) => string) =>
        `WHERE ${[visitorFolder(p), shareCond('a.share_token', p), botCond(p), spamCond(p)].filter(Boolean).join(' AND ')}`;
      const visitorWhereDate = (p: (v: any) => string, days: string) => `${visitorWhere(p)} AND a.created_at > NOW() - INTERVAL '${days} days'`;

      const mediaWhere = (p: (v: any) => string) =>
        `WHERE ${[folderCond('m.folder_path', p), shareCond('a.share_token', p)].filter(Boolean).join(' AND ')}`;

      const shareLabel = `COALESCE(s.folder_path, s.media_id::text, a.share_token)`;
      const sharesOnly = (p: (v: any) => string) => `AND a.share_token IS NOT NULL${shareOnly && shareToken ? ` AND a.share_token = ${p(shareToken)}` : ''}`;
      const downloadShare = (p: (v: any) => string) => (shareOnly ? (shareToken ? ` AND a.share_token = ${p(shareToken)}` : ` AND a.share_token IS NOT NULL`) : '');

      const selfHost = (() => {
        try { return new URL(process.env.APP_DOMAIN || '').hostname; } catch { return ''; }
      })();

      const [
        photosStats,
        videosStats,
        availableShares,
        visitsStats,
        visitorStats,
        osStats,
        browserStats,
        deviceStats,
        timeline,
        topIPs,
        peakHours,
        rawReferrers,
        bandwidthTotal,
        bandwidthByDay,
        topBandwidthMedia,
        topBandwidthShares,
        popularFolders,
        shareConversion,
        blockedStats,
        blockedRecent,
        folderBreakdown,
        viewsByDay,
        downloadsTotal,
        downloadsByDay,
        topFileDownloads,
        topFolderDownloads,
        topShares,
        topMedia,
        expiringShares
      ] = await Promise.all([
        run(p => `SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as size FROM media_files WHERE mime_type LIKE 'image/%' AND ${folderCond('folder_path', p)}`),
        run(p => `SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as size FROM media_files WHERE mime_type LIKE 'video/%' AND ${folderCond('folder_path', p)}`),
        run(p => `SELECT share_token, COALESCE(folder_path, share_token) as label FROM shared_folders WHERE is_active = true AND ${folderCond('folder_path', p)} ORDER BY created_at DESC`),
        run(p => `SELECT COUNT(*) as count FROM media_analytics a JOIN media_files m ON a.media_id = m.id ${mediaWhere(p)}`),
        run(p => `SELECT COUNT(*) as total, COUNT(DISTINCT a.ip_hash) as unique_visitors FROM analytics_visits a ${visitorWhere(p)}`),
        run(p => `SELECT COALESCE(NULLIF(a.os, ''), 'Unknown') as name, COUNT(*) as count FROM analytics_visits a ${visitorWhere(p)} GROUP BY name ORDER BY count DESC`),
        run(p => `SELECT COALESCE(NULLIF(a.browser, ''), 'Unknown') as name, COUNT(*) as count FROM analytics_visits a ${visitorWhere(p)} GROUP BY name ORDER BY count DESC`),
        run(p => `SELECT COALESCE(NULLIF(a.device_type, ''), 'unknown') as name, COUNT(*) as count FROM analytics_visits a ${visitorWhere(p)} GROUP BY name ORDER BY count DESC`),
        run(p => `SELECT to_char(date_trunc('day', a.created_at), 'YYYY-MM-DD') as day, COUNT(*) as count FROM analytics_visits a ${visitorWhereDate(p, '30')} GROUP BY day ORDER BY day`),
        run(p => `SELECT a.ip, COUNT(*) as visits FROM analytics_visits a ${visitorWhere(p)} GROUP BY a.ip ORDER BY visits DESC LIMIT 100`),
        run(p => `SELECT EXTRACT(HOUR FROM a.created_at)::int as hour, COUNT(*) as count FROM analytics_visits a ${visitorWhere(p)} GROUP BY hour ORDER BY hour`),
        run(p => `SELECT a.referrer, COUNT(*) as count FROM analytics_visits a ${visitorWhere(p)} GROUP BY a.referrer ORDER BY count DESC`),
        run(p => `SELECT COALESCE(SUM(a.bytes_served), 0) as bytes FROM media_analytics a JOIN media_files m ON a.media_id = m.id ${mediaWhere(p)}`),
        run(p => `SELECT to_char(date_trunc('day', a.created_at), 'YYYY-MM-DD') as day, COALESCE(SUM(a.bytes_served), 0) as bytes FROM media_analytics a JOIN media_files m ON a.media_id = m.id ${mediaWhere(p)} AND a.created_at > NOW() - INTERVAL '30 days' GROUP BY day ORDER BY day`),
        run(p => `SELECT m.id, m.file_name, m.folder_path, COALESCE(SUM(a.bytes_served), 0) as bytes, COUNT(*) as views FROM media_analytics a JOIN media_files m ON a.media_id = m.id ${mediaWhere(p)} GROUP BY m.id, m.file_name, m.folder_path ORDER BY bytes DESC LIMIT 500`),
        run(p => `SELECT ${shareLabel} as label, a.share_token, COALESCE(SUM(a.bytes_served), 0) as bytes, COUNT(*) as views FROM media_analytics a JOIN media_files m ON a.media_id = m.id LEFT JOIN shared_folders s ON a.share_token = s.share_token ${mediaWhere(p)} GROUP BY label, a.share_token ORDER BY bytes DESC LIMIT 500`),
        run(p => `SELECT m.folder_path, COUNT(*) as views FROM media_analytics a JOIN media_files m ON a.media_id = m.id ${mediaWhere(p)} GROUP BY m.folder_path ORDER BY views DESC LIMIT 500`),
        run(p => `SELECT COALESCE(s.folder_path, s.media_id::text, v.share_token) as label, v.share_token, COUNT(*) as visits, COUNT(DISTINCT v.ip_hash) as unique_visitors, (SELECT COUNT(*) FROM media_analytics ma JOIN media_files mm ON ma.media_id = mm.id WHERE ma.share_token = v.share_token AND ${folderCond('mm.folder_path', p)}) as media_views FROM analytics_visits v JOIN media_files mv ON v.media_id = mv.id LEFT JOIN shared_folders s ON v.share_token = s.share_token WHERE ${folderCond('mv.folder_path', p)} AND v.share_token IS NOT NULL${shareOnly && shareToken ? ` AND v.share_token = ${p(shareToken)}` : ''} GROUP BY label, v.share_token ORDER BY unique_visitors DESC LIMIT 500`),
        run(p => `SELECT COUNT(*) as count FROM analytics_visits a WHERE ${visitorFolder(p)} AND a.action_type IN ('blocked_access', 'not_found')`),
        run(p => `SELECT to_char(date_trunc('day', a.created_at), 'YYYY-MM-DD') as day, COUNT(*) as count FROM analytics_visits a WHERE ${visitorFolder(p)} AND a.action_type IN ('blocked_access', 'not_found') AND a.created_at > NOW() - INTERVAL '7 days' GROUP BY day ORDER BY day`),
        run(p => `SELECT folder_path, COUNT(*) FILTER (WHERE mime_type LIKE 'image/%') as photos, COUNT(*) FILTER (WHERE mime_type LIKE 'video/%') as videos FROM media_files WHERE ${folderCond('folder_path', p)} GROUP BY folder_path ORDER BY (COUNT(*) FILTER (WHERE mime_type LIKE 'image/%') + COUNT(*) FILTER (WHERE mime_type LIKE 'video/%')) DESC LIMIT 500`),
        run(p => `SELECT to_char(date_trunc('day', a.created_at), 'YYYY-MM-DD') as day, COUNT(*) as count FROM media_analytics a JOIN media_files m ON a.media_id = m.id ${mediaWhere(p)} AND a.created_at > NOW() - INTERVAL '30 days' GROUP BY day ORDER BY day`),
        run(p => `SELECT COUNT(*) as count FROM analytics_visits a ${visitorWhere(p)} AND a.action_type IN ('download', 'download_folder')`),
        run(p => `SELECT to_char(date_trunc('day', a.created_at), 'YYYY-MM-DD') as day, COUNT(*) as count FROM analytics_visits a JOIN media_files m ON a.media_id = m.id WHERE a.action_type = 'download' AND ${folderCond('m.folder_path', p)}${downloadShare(p)} AND a.created_at > NOW() - INTERVAL '30 days' GROUP BY day ORDER BY day`),
        run(p => `SELECT m.id, m.file_name, m.folder_path, COUNT(*) as downloads FROM analytics_visits a JOIN media_files m ON a.media_id = m.id WHERE a.action_type = 'download' AND ${folderCond('m.folder_path', p)}${downloadShare(p)} GROUP BY m.id, m.file_name, m.folder_path ORDER BY downloads DESC LIMIT 500`),
        run(p => `SELECT a.folder_path, COUNT(*) as downloads FROM analytics_visits a WHERE a.action_type = 'download_folder' AND ${folderCond('a.folder_path', p)}${downloadShare(p)} GROUP BY a.folder_path ORDER BY downloads DESC LIMIT 500`),
        run(p => `SELECT COALESCE(s.folder_path, s.media_id::text) as folder_path, COUNT(*) as views FROM media_analytics a JOIN media_files m ON a.media_id = m.id LEFT JOIN shared_folders s ON a.share_token = s.share_token ${mediaWhere(p)} ${sharesOnly(p)} GROUP BY COALESCE(s.folder_path, s.media_id::text) ORDER BY views DESC LIMIT 500`),
        run(p => `SELECT m.id, m.file_name, m.folder_path, COUNT(*) as views FROM media_analytics a JOIN media_files m ON a.media_id = m.id ${mediaWhere(p)} ${sharesOnly(p)} GROUP BY m.id, m.file_name, m.folder_path ORDER BY views DESC LIMIT 500`),
        run(p => `SELECT s.share_token, s.folder_path, s.media_id, s.expires_at, s.is_active, u.email as creator_email FROM shared_folders s LEFT JOIN users u ON s.created_by = u.id WHERE s.is_active = true AND s.expires_at IS NOT NULL AND s.expires_at < NOW() + INTERVAL '7 days' AND ${folderCond('s.folder_path', p)} ORDER BY s.expires_at ASC`)
      ]);

      const toInt = (v: any) => parseInt(v, 10);

      // Normalize referrers into source buckets (Direct, domain, ...) and drop spam
      const refMap = new Map<string, number>();
      for (const r of rawReferrers.rows) {
        const { name, spam } = normalizeReferrer(r.referrer, selfHost);
        if (filterSpam && spam) continue;
        refMap.set(name, (refMap.get(name) || 0) + toInt(r.count));
      }
      const topReferrers = [...refMap.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 500);

      const normBreakdown = (rows: any[]) => rows.map(r => ({ name: r.name, count: toInt(r.count) }));
      const normIPs = (rows: any[]) => rows.map(r => ({ ip: r.ip, visits: toInt(r.visits) }));

      return reply.send({
        filters: { filterBots, filterSpam },
        folder: { path: folderPath, includeDescendants: descend, scope, shareToken: shareOnly ? shareToken || null : null },
        availableShares: availableShares.rows.map(r => ({ share_token: r.share_token, label: r.label })),
        stats: {
          photos: { count: toInt(photosStats.rows[0].count), size: toInt(photosStats.rows[0].size) },
          videos: { count: toInt(videosStats.rows[0].count), size: toInt(videosStats.rows[0].size) },
          visits: toInt(visitsStats.rows[0].count),
          visitors: { total: toInt(visitorStats.rows[0].total), unique: toInt(visitorStats.rows[0].unique_visitors) },
          bandwidth: toInt(bandwidthTotal.rows[0].bytes),
          downloads: toInt(downloadsTotal.rows[0].count)
        },
        topShares: topShares.rows.map(r => ({ folder_path: r.folder_path, views: toInt(r.views) })),
        topMedia: topMedia.rows.map(r => ({ id: r.id, file_name: r.file_name, folder_path: r.folder_path, views: toInt(r.views) })),
        osBreakdown: normBreakdown(osStats.rows),
        browserBreakdown: normBreakdown(browserStats.rows),
        deviceBreakdown: normBreakdown(deviceStats.rows),
        timeline: timeline.rows.map(r => ({ day: r.day, count: toInt(r.count) })),
        topIPs: normIPs(topIPs.rows),
        topReferrers,
        peakHours: peakHours.rows.map(r => ({ hour: toInt(r.hour), count: toInt(r.count) })),
        bandwidthByDay: bandwidthByDay.rows.map(r => ({ day: r.day, bytes: toInt(r.bytes) })),
        topBandwidthMedia: topBandwidthMedia.rows.map(r => ({ id: r.id, file_name: r.file_name, folder_path: r.folder_path, bytes: toInt(r.bytes), views: toInt(r.views) })),
        topBandwidthShares: topBandwidthShares.rows.map(r => ({ label: r.label, share_token: r.share_token, bytes: toInt(r.bytes), views: toInt(r.views) })),
        popularFolders: popularFolders.rows.map(r => ({ folder_path: r.folder_path, views: toInt(r.views) })),
        shareConversion: shareConversion.rows.map(r => ({ label: r.label, share_token: r.share_token, visits: toInt(r.visits), unique_visitors: toInt(r.unique_visitors), media_views: toInt(r.media_views) })),
        blockedAttempts: {
          total: toInt(blockedStats.rows[0].count),
          recent: blockedRecent.rows.map(r => ({ day: r.day, count: toInt(r.count) }))
        },
        folderBreakdown: folderBreakdown.rows.map(r => ({ folder_path: r.folder_path, photos: toInt(r.photos), videos: toInt(r.videos) })),
        viewsByDay: viewsByDay.rows.map(r => ({ day: r.day, count: toInt(r.count) })),
        downloadsByDay: downloadsByDay.rows.map(r => ({ day: r.day, count: toInt(r.count) })),
        topFileDownloads: topFileDownloads.rows.map(r => ({ id: r.id, file_name: r.file_name, folder_path: r.folder_path, downloads: toInt(r.downloads) })),
        topFolderDownloads: topFolderDownloads.rows.map(r => ({ folder_path: r.folder_path, downloads: toInt(r.downloads) })),
        expiringShares: expiringShares.rows
      });
    } catch (e: any) {
      request.log.error(e);
      return reply.status(500).send({ error: e.message });
    }
  });

  // Lightweight endpoint for dashboard alerts (avoids loading full analytics)
  fastify.get('/api/admin/expiring-shares', async (request, reply) => {
    try {
      const { rows } = await query(`
        SELECT s.share_token, s.folder_path, s.media_id, s.expires_at, u.email as creator_email
        FROM shared_folders s
        LEFT JOIN users u ON s.created_by = u.id
        WHERE s.is_active = true AND s.expires_at IS NOT NULL AND s.expires_at < NOW() + INTERVAL '7 days'
        ORDER BY s.expires_at ASC
      `);
      return reply.send({ shares: rows });
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
