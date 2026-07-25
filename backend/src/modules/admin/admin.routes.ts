import bcrypt from 'bcryptjs';
import { requireAuth } from '../../utils/auth';
import { FastifyInstance } from 'fastify';
import { redis } from '../../config/redis';
import { ScannerService } from '../scanner/scanner.service';
import { mlQueue } from '../../queue/mlQueue';
import { mediaQueue } from '../../queue/mediaQueue';
import { query } from '../../config/db';
import path from 'path';

export async function adminRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', requireAuth);
  
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.user?.role !== 'admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }
  });

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
    const { email, password, name, role, folders } = request.body as any;
    if (!email || !password || !role) return reply.status(400).send({ error: 'Missing fields' });
    
    const passwordHash = await bcrypt.hash(password, 10);
    try {
      const { rows } = await query(
        'INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
        [email, name || 'Unknown', passwordHash, role]
      );
      const userId = rows[0].id;
      
      if (role !== 'admin' && Array.isArray(folders)) {
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
    const { id } = request.params as any;
    const { email, name, role, password, folders } = request.body as any;
    
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
    
    if (role !== 'admin') {
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
    const { id } = request.params as any;
    await query('DELETE FROM users WHERE id = $1', [id]);
    return reply.send({ success: true });
  });

  fastify.get('/api/admin/settings', async (request, reply) => {
    const maxCores = await redis.get('settings:max_cpu_cores');
    const scanInterval = await redis.get('settings:scan_interval');
    
    return reply.send({
      maxCpuCores: maxCores ? parseInt(maxCores, 10) : 2,
      scanInterval: scanInterval ? parseInt(scanInterval, 10) : 3600000
    });
  });

  fastify.put('/api/admin/settings', async (request, reply) => {
    const { maxCpuCores, scanInterval } = request.body as any;
    
    if (maxCpuCores) await redis.set('settings:max_cpu_cores', String(maxCpuCores));
    if (scanInterval) await redis.set('settings:scan_interval', String(scanInterval));
    
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
    const result = await query(`SELECT id FROM media_files WHERE mime_type LIKE 'image/%'`);
    for (const row of result.rows) {
      await mlQueue.add('detect-faces', { mediaId: row.id });
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
}
