import { FastifyInstance } from 'fastify';
import { requireAuth } from '../../utils/auth';
import { mediaQueue } from '../../queue/mediaQueue';
import { mlQueue } from '../../queue/mlQueue';
import { scannerQueue } from '../../queue/scannerQueue';
import { query } from '../../config/db';

export async function queueRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', requireAuth);
  fastify.addHook('onRequest', async (request, reply) => {
    if ((request as any).user?.role !== 'admin' && (request as any).user?.role !== 'super_admin') {
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
      
      const activeJobsRaw = await q.getJobs(['active']);
      const activeJobs = await Promise.all(activeJobsRaw.map(async (j: any) => {
        let target = j?.data?.fullPath || j?.data?.folderPath;
        if (!target && j?.data?.mediaId) {
          try {
            const res = await query('SELECT folder_path, file_name FROM media_files WHERE id = $1', [j.data.mediaId]);
            if (res.rows.length > 0) {
              const r = res.rows[0];
              target = r.folder_path ? `${r.folder_path}/${r.file_name}` : r.file_name;
            } else {
              target = j.data.mediaId;
            }
          } catch (e) {
            target = j.data.mediaId;
          }
        }
        return {
          id: j?.id,
          target: target || 'Unknown task'
        };
      }));

      stats[name] = { counts, isPaused, activeJobs };
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

  fastify.post('/api/admin/queues/:name/stop', async (request, reply) => {
    const { name } = request.params as any;
    const q = (getQueues() as any)[name];
    if (!q) return reply.status(404).send({ error: 'Queue not found' });
    await q.pause();
    await q.drain(true);
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
