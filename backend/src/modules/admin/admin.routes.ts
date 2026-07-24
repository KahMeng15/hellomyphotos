import { FastifyInstance } from 'fastify';
import { redis } from '../../config/redis';
import { ScannerService } from '../scanner/scanner.service';
import { mlQueue } from '../../queue/mlQueue';
import { query } from '../../config/db';

export async function adminRoutes(fastify: FastifyInstance) {
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
}
