import { FastifyInstance } from 'fastify';
import { requireAuth } from '../../utils/auth';
import {
  queues,
  getExecutionMode,
  setExecutionMode,
  scannerQueue,
  metadataQueue,
  thumbnailQueue,
  videoQueue,
  smartSearchQueue,
  faceDetectionQueue,
  facialRecognitionQueue
} from '../../queue';
import { query } from '../../config/db';
import path from 'path';

export async function queueRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', requireAuth);
  fastify.addHook('onRequest', async (request, reply) => {
    const userRole = (request as any).user?.role;
    if (userRole !== 'admin' && userRole !== 'super_admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }
  });

  // GET /api/admin/queues/mode
  fastify.get('/api/admin/queues/mode', async (request, reply) => {
    const mode = await getExecutionMode();
    return reply.send({ mode });
  });

  // POST /api/admin/queues/mode
  fastify.post('/api/admin/queues/mode', async (request, reply) => {
    const { mode } = request.body as { mode: 'sequential' | 'concurrent' };
    if (mode !== 'sequential' && mode !== 'concurrent') {
      return reply.status(400).send({ error: "Mode must be 'sequential' or 'concurrent'" });
    }
    const updatedMode = await setExecutionMode(mode);
    return reply.send({ success: true, mode: updatedMode });
  });

  // GET /api/admin/queues
  fastify.get('/api/admin/queues', async (request, reply) => {
    const stats: Record<string, any> = {};
    const currentMode = await getExecutionMode();

    for (const [name, q] of Object.entries(queues)) {
      const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
      const isPaused = await q.isPaused();

      const total = counts.waiting + counts.active + counts.completed + counts.failed;
      const progress = total > 0 ? Math.round((counts.completed / total) * 100) : 0;

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
          target: target || 'Processing item...'
        };
      }));

      stats[name] = { counts, isPaused, activeJobs, progress };
    }

    return reply.send({ queues: stats, mode: currentMode });
  });

  // POST /api/admin/queues/:name/pause
  fastify.post('/api/admin/queues/:name/pause', async (request, reply) => {
    const { name } = request.params as any;
    const q = queues[name];
    if (!q) return reply.status(404).send({ error: `Queue '${name}' not found` });
    await q.pause();
    return reply.send({ success: true });
  });

  // POST /api/admin/queues/:name/resume
  fastify.post('/api/admin/queues/:name/resume', async (request, reply) => {
    const { name } = request.params as any;
    const q = queues[name];
    if (!q) return reply.status(404).send({ error: `Queue '${name}' not found` });
    await q.resume();
    return reply.send({ success: true });
  });

  // POST /api/admin/queues/:name/stop
  fastify.post('/api/admin/queues/:name/stop', async (request, reply) => {
    const { name } = request.params as any;
    const q = queues[name];
    if (!q) return reply.status(404).send({ error: `Queue '${name}' not found` });
    await q.pause();
    await q.drain(true);
    return reply.send({ success: true });
  });

  // POST /api/admin/queues/:name/clean
  fastify.post('/api/admin/queues/:name/clean', async (request, reply) => {
    const { name } = request.params as any;
    const { type } = request.body as any; // 'failed', 'completed', 'wait'
    const q = queues[name];
    if (!q) return reply.status(404).send({ error: `Queue '${name}' not found` });

    await q.clean(0, 1000, type || 'failed');
    return reply.send({ success: true });
  });

  // POST /api/admin/queues/:name/trigger
  fastify.post('/api/admin/queues/:name/trigger', async (request, reply) => {
    const { name } = request.params as any;
    const q = queues[name];
    if (!q) return reply.status(404).send({ error: `Queue '${name}' not found` });

    await q.resume();

    if (name === 'scanner') {
      await scannerQueue.add('scan-directory', { folderPath: '' });
    } else if (name === 'metadata') {
      const res = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files`);
      for (const row of res.rows) {
        await metadataQueue.add('extract-metadata', {
          mediaId: row.id,
          fullPath: path.join('/app/media', row.folder_path || '', row.file_name),
          mimeType: row.mime_type
        });
      }
    } else if (name === 'thumbnail') {
      const res = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'image/%'`);
      for (const row of res.rows) {
        await thumbnailQueue.add('generate-thumbnail', {
          mediaId: row.id,
          fullPath: path.join('/app/media', row.folder_path || '', row.file_name),
          mimeType: row.mime_type
        });
      }
    } else if (name === 'video') {
      const res = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'video/%'`);
      for (const row of res.rows) {
        await videoQueue.add('process-video', {
          mediaId: row.id,
          fullPath: path.join('/app/media', row.folder_path || '', row.file_name),
          mimeType: row.mime_type
        });
      }
    } else if (name === 'smart-search') {
      const res = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files`);
      for (const row of res.rows) {
        await smartSearchQueue.add('generate-smart-search', {
          mediaId: row.id,
          fullPath: path.join('/app/media', row.folder_path || '', row.file_name),
          mimeType: row.mime_type
        });
      }
    } else if (name === 'face-detection') {
      const res = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'image/%'`);
      for (const row of res.rows) {
        await faceDetectionQueue.add('detect-faces', {
          mediaId: row.id,
          fullPath: path.join('/app/media', row.folder_path || '', row.file_name),
          mimeType: row.mime_type
        });
      }
    } else if (name === 'facial-recognition') {
      const res = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'image/%'`);
      for (const row of res.rows) {
        await facialRecognitionQueue.add('recognize-faces', {
          mediaId: row.id,
          fullPath: path.join('/app/media', row.folder_path || '', row.file_name),
          mimeType: row.mime_type
        });
      }
    }

    return reply.send({ success: true, message: `Triggered queue '${name}'` });
  });
}
