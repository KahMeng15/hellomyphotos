import bcrypt from 'bcryptjs';
import { requireAuth } from '../../utils/auth';
import { FastifyInstance } from 'fastify';
import { redis } from '../../config/redis';
import { ScannerService } from '../scanner/scanner.service';
import { mlQueue } from '../../queue/mlQueue';
import { mediaQueue } from '../../queue/mediaQueue';
import { faceDetectionQueue } from '../../queue/faceDetectionQueue';
import { query } from '../../config/db';
import path from 'path';
import fs from 'fs';

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
      mlConfidenceThreshold: 0.6,
      throttleAuth: 0,
      throttlePublic: 0,
      rateLimitApi: 100,
      watermarkText: 'hellomyphotos',
      watermarkOpacity: 0.5,
      watermarkPosition: 'center',
      watermarkEnforceGlobal: false
    };
    
    for (const r of rows) {
      if (r.key === 'max_cpu_cores') settings.maxCpuCores = r.value;
      if (r.key === 'scan_interval') settings.scanInterval = r.value;
      if (r.key === 'ml_confidence') settings.mlConfidenceThreshold = r.value;
      if (r.key === 'throttle_auth') settings.throttleAuth = r.value;
      if (r.key === 'throttle_public') settings.throttlePublic = r.value;
      if (r.key === 'rate_limit_api') settings.rateLimitApi = r.value;
      if (r.key === 'watermark_text') settings.watermarkText = r.value;
      if (r.key === 'watermark_opacity') settings.watermarkOpacity = r.value;
      if (r.key === 'watermark_position') settings.watermarkPosition = r.value;
      if (r.key === 'watermark_enforce_global') settings.watermarkEnforceGlobal = r.value;
    }
    
    return reply.send(settings);
  });

  fastify.put('/api/admin/settings', async (request, reply) => {
    const { maxCpuCores, scanInterval, mlConfidenceThreshold, throttleAuth, throttlePublic, rateLimitApi, watermarkText, watermarkOpacity, watermarkPosition, watermarkEnforceGlobal } = request.body as any;
    
    const updates = [];
    if (maxCpuCores !== undefined) updates.push({ k: 'max_cpu_cores', v: maxCpuCores });
    if (scanInterval !== undefined) updates.push({ k: 'scan_interval', v: scanInterval });
    if (mlConfidenceThreshold !== undefined) updates.push({ k: 'ml_confidence', v: mlConfidenceThreshold });
    if (throttleAuth !== undefined) updates.push({ k: 'throttle_auth', v: throttleAuth });
    if (throttlePublic !== undefined) updates.push({ k: 'throttle_public', v: throttlePublic });
    if (rateLimitApi !== undefined) updates.push({ k: 'rate_limit_api', v: rateLimitApi });
    if (watermarkText !== undefined) updates.push({ k: 'watermark_text', v: watermarkText });
    if (watermarkOpacity !== undefined) updates.push({ k: 'watermark_opacity', v: watermarkOpacity });
    if (watermarkPosition !== undefined) updates.push({ k: 'watermark_position', v: watermarkPosition });
    if (watermarkEnforceGlobal !== undefined) updates.push({ k: 'watermark_enforce_global', v: watermarkEnforceGlobal });
    
    for (const u of updates) {
      await query(
        'INSERT INTO admin_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
        [u.k, JSON.stringify(u.v)]
      );
    }
    
    return reply.send({ success: true });
  });

  fastify.post('/api/admin/rescan', async (request, reply) => {
    // Run it asynchronously in the background so we don't block the HTTP request
    ScannerService.scanAllDirectories('').catch(console.error);
    return reply.send({ success: true, message: 'Rescan initiated in the background' });
  });

  fastify.post('/api/admin/rescan-faces', async (request, reply) => {
    // 1. Wipe out existing face embeddings
    await query(`TRUNCATE TABLE face_embeddings`);

    // 2. Queue every media file for face detection again
    const result = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'image/%'`);
    for (const row of result.rows) {
      const fullPath = path.join(process.env.MEDIA_ROOT || '/app/media', row.folder_path, row.file_name);
      await faceDetectionQueue.add('detect-faces', { mediaId: row.id, fullPath, mimeType: row.mime_type });
    }
    
    return reply.send({ success: true, message: 'Face reset initiated in the background' });
  });

  fastify.post('/api/admin/rescan-exif', async (request, reply) => {
    // Queue every media file for EXIF reprocessing
    const result = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'image/%'`);
    for (const row of result.rows) {
      await mediaQueue.add('process-media', { 
        mediaId: row.id,
        fullPath: path.join('/app/media', row.folder_path, row.file_name),
        mimeType: row.mime_type
      });
    }
    return reply.send({ success: true, message: 'EXIF extraction initiated in the background' });
  });

  fastify.post('/api/admin/reset-index', async (request, reply) => {
    await query(`TRUNCATE TABLE face_embeddings CASCADE`);
    await query(`TRUNCATE TABLE media_analytics CASCADE`);
    await query(`TRUNCATE TABLE media_files CASCADE`);
    await query(`TRUNCATE TABLE folders CASCADE`);
    
    const cacheRoot = process.env.CACHE_ROOT || '/app/cache';
    fs.rmSync(path.join(cacheRoot, '1080p'), { recursive: true, force: true });
    fs.rmSync(path.join(cacheRoot, '480p'), { recursive: true, force: true });
    fs.mkdirSync(path.join(cacheRoot, '1080p'), { recursive: true });
    fs.mkdirSync(path.join(cacheRoot, '480p'), { recursive: true });

    ScannerService.scanAllDirectories('').catch(console.error);
    return reply.send({ success: true, message: 'Index wiped and rescan initiated in the background' });
  });

  fastify.post('/api/admin/reset-exif', async (request, reply) => {
    await query(`UPDATE media_files SET blurhash = NULL, exif_json = NULL`);
    
    const cacheRoot = process.env.CACHE_ROOT || '/app/cache';
    fs.rmSync(path.join(cacheRoot, '1080p'), { recursive: true, force: true });
    fs.rmSync(path.join(cacheRoot, '480p'), { recursive: true, force: true });
    fs.mkdirSync(path.join(cacheRoot, '1080p'), { recursive: true });
    fs.mkdirSync(path.join(cacheRoot, '480p'), { recursive: true });

    const result = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'image/%'`);
    for (const row of result.rows) {
      await mediaQueue.add('process-media', { 
        mediaId: row.id,
        fullPath: path.join('/app/media', row.folder_path, row.file_name),
        mimeType: row.mime_type
      });
    }
    return reply.send({ success: true, message: 'Media/EXIF reset initiated in the background' });
  });

  fastify.post('/api/admin/reset-faces', async (request, reply) => {
    await query(`TRUNCATE TABLE face_embeddings CASCADE`);

    const result = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'image/%'`);
    for (const row of result.rows) {
      const fullPath = path.join(process.env.MEDIA_ROOT || '/app/media', row.folder_path, row.file_name);
      await faceDetectionQueue.add('detect-faces', { mediaId: row.id, fullPath, mimeType: row.mime_type });
    }
    return reply.send({ success: true, message: 'Face reset initiated in the background' });
  });

  fastify.get('/api/admin/logs', async (request, reply) => {
    const { rows } = await query(`
      SELECT l.id, l.level, l.message, l.ip_address, l.created_at, u.email as user_email
      FROM system_logs l
      LEFT JOIN users u ON l.user_id = u.id
      ORDER BY l.created_at DESC
      LIMIT 500
    `);
    return reply.send({ logs: rows });
  });

  fastify.get('/api/admin/analytics', async (request, reply) => {
    try {
      const stats = await query(`
        SELECT 
          (SELECT COUNT(*) FROM media_analytics WHERE event_type = 'view_shared_link') as total_shared_visits,
          (SELECT COUNT(DISTINCT ip_address) FROM media_analytics) as unique_visitors,
          (SELECT COUNT(*) FROM media_analytics WHERE event_type = 'download_shared_link') as total_shared_downloads
      `);
      
      const linkRanking = await query(`
        SELECT 
          a.share_token, 
          COALESCE(s.folder_path, s.media_id) as target,
          COUNT(*) as visits
        FROM media_analytics a
        LEFT JOIN shared_folders s ON a.share_token = s.share_token
        WHERE a.event_type = 'view_shared_link' AND a.share_token IS NOT NULL
        GROUP BY a.share_token, target
        ORDER BY visits DESC
        LIMIT 10
      `);

      return reply.send({
        kpis: {
          totalSharedVisits: parseInt(stats.rows[0].total_shared_visits || '0'),
          uniqueVisitors: parseInt(stats.rows[0].unique_visitors || '0'),
          totalSharedDownloads: parseInt(stats.rows[0].total_shared_downloads || '0')
        },
        linkRanking: linkRanking.rows
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
               (SELECT COUNT(*) FROM media_analytics a WHERE a.share_token = s.share_token AND a.event_type = 'view_shared_link') as views,
               (SELECT COUNT(*) FROM media_analytics a WHERE a.share_token = s.share_token AND a.event_type = 'download_shared_link') as downloads
        FROM shared_folders s
        ORDER BY s.created_at DESC
      `);
      return reply.send({ shares: rows });
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
