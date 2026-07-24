import { FastifyInstance } from 'fastify';
import { redis } from '../../config/redis';

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
}
