import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { redis } from '../../config/redis';
import { scannerQueue } from '../../queue/scannerQueue';
import { query } from '../../config/db';

export async function scannerRoutes(fastify: FastifyInstance) {
  
  fastify.get<{ Params: { '*': string } }>('/api/folder/*', async (request, reply) => {
    // URL decode the path param and sanitize
    const folderPath = decodeURIComponent(request.params['*'] || '');
    
    // 1. Query Redis for Cooldown
    const cooldownKey = `scan_cooldown:${folderPath}`;
    const exists = await redis.exists(cooldownKey);
    
    if (!exists) {
      // 2. Set Cooldown & Push Job
      await redis.set(cooldownKey, '1', 'EX', 60); // 60 seconds
      await scannerQueue.add('scan-directory', { folderPath });
    }

    // 3. Serve Directory Tree from DB
    const result = await query(
      `SELECT * FROM media_files WHERE folder_path = $1 ORDER BY file_name ASC`, 
      [folderPath]
    );

    return reply.send({
      folderPath,
      scanning: !exists, // Indicate if a scan was just triggered
      files: result.rows
    });
  });
}
