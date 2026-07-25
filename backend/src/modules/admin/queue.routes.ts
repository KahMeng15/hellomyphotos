import { FastifyInstance } from 'fastify';
import { requireAuth } from '../../utils/auth';
import { mediaQueue } from '../../queue/mediaQueue';
import { mlQueue } from '../../queue/mlQueue';
import { scannerQueue } from '../../queue/scannerQueue';

export async function queueRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', requireAuth);
  fastify.addHook('onRequest', async (request, reply) => {
    if ((request as any).user?.role !== 'admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }
  });

  const getQueues = () => ({
    media: mediaQueue,
    ml: mlQueue,
    scanner: scannerQueue
  });

  fastify.get('/api/admin/queues', async (request, reply) => {
    const queues = getQueues();
    const stats: any = {};
    
    for (const [name, q] of Object.entries(queues)) {
      const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
      const isPaused = await q.isPaused();
      stats[name] = { counts, isPaused };
    }
    
    return reply.send({ queues: stats });
  });

  fastify.post('/api/admin/queues/:name/pause', async (request, reply) => {
    const { name } = request.params as any;
    const q = (getQueues() as any)[name];
    if (!q) return reply.status(404).send({ error: 'Queue not found' });
    await q.pause();
    return reply.send({ success: true });
  });

  fastify.post('/api/admin/queues/:name/resume', async (request, reply) => {
    const { name } = request.params as any;
    const q = (getQueues() as any)[name];
    if (!q) return reply.status(404).send({ error: 'Queue not found' });
    await q.resume();
    return reply.send({ success: true });
  });

  fastify.post('/api/admin/queues/:name/clean', async (request, reply) => {
    const { name } = request.params as any;
    const { type } = request.body as any; // 'failed', 'completed', 'wait'
    const q = (getQueues() as any)[name];
    if (!q) return reply.status(404).send({ error: 'Queue not found' });
    
    await q.clean(0, 1000, type || 'failed');
    return reply.send({ success: true });
  });
}
