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
      const bullmqCounts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
      const isPaused = await q.isPaused();

      // Derive accurate pipeline counts from the database
      let total = 0;
      let completed = 0;
      try {
        switch (name) {
          case 'scanner': {
            const dbRes = await query('SELECT COUNT(DISTINCT folder_path)::int as folders, COUNT(*)::int as files FROM media_files');
            (q as any).extraStats = { folders: dbRes.rows[0].folders, files: dbRes.rows[0].files };
            
            // Use database unique folders for 'completed' to avoid endlessly growing BullMQ history
            completed = dbRes.rows[0].folders;
            total = (bullmqCounts.waiting || 0) + (bullmqCounts.active || 0) + (bullmqCounts.failed || 0) + completed;
            break;
          }
          case 'metadata': {
            const r = await query('SELECT COUNT(*)::int as total, COUNT(exif_json)::int as completed FROM media_files');
            total = r.rows[0].total; completed = r.rows[0].completed;
            break;
          }
          case 'thumbnail': {
            const r = await query(`SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE has_1080p AND has_480p)::int as completed FROM media_files WHERE mime_type LIKE 'image/%'`);
            total = r.rows[0].total; completed = r.rows[0].completed;
            break;
          }
          case 'video': {
            const r = await query(`SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE has_480p IS NOT NULL)::int as completed FROM media_files WHERE mime_type LIKE 'video/%'`);
            total = r.rows[0].total; completed = r.rows[0].completed;
            break;
          }
          case 'smart-search': {
            const r = await query(`SELECT COUNT(*)::int as total, COUNT(clip_embedding)::int as completed FROM media_files WHERE mime_type LIKE 'image/%'`);
            total = r.rows[0].total; completed = r.rows[0].completed;
            break;
          }
          case 'face-detection': {
            const r = await query(`
              SELECT (SELECT COUNT(*)::int FROM media_files WHERE mime_type LIKE 'image/%') as total,
                     COALESCE((SELECT COUNT(DISTINCT media_id)::int FROM face_embeddings), 0) as completed
            `);
            total = r.rows[0].total; completed = r.rows[0].completed;
            break;
          }
          case 'facial-recognition': {
            const r = await query(`
              SELECT (SELECT COUNT(*)::int FROM face_embeddings) as total,
                     (SELECT COUNT(*)::int FROM face_embeddings WHERE person_id IS NOT NULL) as completed
            `);
            total = r.rows[0].total; completed = r.rows[0].completed;
            break;
          }
          case 'face-thumbnail': {
            const cacheRoot = process.env.CACHE_ROOT || path.resolve(process.cwd(), '../volumes/cache_rw');
            const facesDir = path.join(cacheRoot, 'faces');
            const r = await query(`
              SELECT COALESCE(
                (SELECT COUNT(*)::int FROM people), 0
              ) AS total
            `);
            total = r.rows[0].total;
            // Count completed by checking how many face thumbnail files actually exist on disk
            try {
              const { readdir } = await import('fs/promises');
              const files = await readdir(facesDir);
              completed = files.filter(f => f.endsWith('.webp')).length;
            } catch {
              completed = 0;
            }
            break;
          }
        }
      } catch (err) {
        console.error(`[Queue Stats] DB query failed for ${name}:`, err);
        total = 0; completed = 0;
      }

      const active = (bullmqCounts.active || 0) + (bullmqCounts.delayed || 0);
      const failed = bullmqCounts.failed || 0;
      const waiting = Math.max(0, total - completed - active);
      const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

      const activeJobsRaw = await q.getJobs(['active']);
      const activeJobs = await Promise.all(activeJobsRaw.map(async (j: any) => {
        let target = j?.data?.fullPath || j?.data?.folderPath;
        if (!target && j?.data?.mediaId) {
          try {
            const res = await query('SELECT folder_path, file_name FROM media_files WHERE id = $1', [j.data.mediaId]);
            if (res.rows.length > 0) {
              const r2 = res.rows[0];
              target = r2.folder_path ? `${r2.folder_path}/${r2.file_name}` : r2.file_name;
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

      stats[name] = {
        counts: { waiting, active, completed, failed, total },
        bullmq: { waiting: bullmqCounts.waiting || 0, active: (bullmqCounts.active || 0) + (bullmqCounts.delayed || 0) },
        isPaused,
        activeJobs,
        progress,
        extra: (q as any).extraStats
      };
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
    // M-2 Fix: Pause the queue and drain pending jobs without resuming immediately.
    // Previously the queue was paused, drained, then immediately resumed — which meant
    // 'Stop' had no lasting effect. Now the queue stays paused until explicitly resumed.
    await q.pause();
    await q.drain(true);
    await q.clean(0, 10000, 'active');
    // Do NOT call q.resume() here — admin must explicitly click Resume to restart.
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

    // Clean any stuck active jobs (e.g. from a crashed worker) so the queue can restart
    await q.clean(0, 10000, 'active');
    await q.resume();

    if (name === 'scanner') {
      const { ScannerService } = await import('../scanner/scanner.service');
      ScannerService.scanAllDirectories('').catch(console.error);
    } else if (name === 'metadata') {
      // H-6 Fix: Only enqueue files that haven't been processed yet (exif_json IS NULL)
      const res = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files WHERE exif_json IS NULL`);
      for (const row of res.rows) {
        await metadataQueue.add('extract-metadata', {
          mediaId: row.id,
          fullPath: path.resolve(process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro'), row.folder_path || '', row.file_name),
          mimeType: row.mime_type
        });
      }
    } else if (name === 'thumbnail') {
      // H-6 Fix: Only enqueue images that are missing either thumbnail size
      const res = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'image/%' AND (NOT has_1080p OR NOT has_480p)`);
      for (const row of res.rows) {
        await thumbnailQueue.add('generate-thumbnail', {
          mediaId: row.id,
          fullPath: path.resolve(process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro'), row.folder_path || '', row.file_name),
          mimeType: row.mime_type
        });
      }
    } else if (name === 'video') {
      // H-6 Fix: Only enqueue videos that haven't been transcoded yet
      const res = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'video/%' AND has_480p IS NULL`);
      for (const row of res.rows) {
        await videoQueue.add('process-video', {
          mediaId: row.id,
          fullPath: path.resolve(process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro'), row.folder_path || '', row.file_name),
          mimeType: row.mime_type
        });
      }
    } else if (name === 'smart-search') {
      // H-6 Fix: Only enqueue files missing a CLIP embedding
      const res = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files WHERE clip_embedding IS NULL`);
      for (const row of res.rows) {
        await smartSearchQueue.add('generate-smart-search', {
          mediaId: row.id,
          fullPath: path.resolve(process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro'), row.folder_path || '', row.file_name),
          mimeType: row.mime_type
        });
      }
    } else if (name === 'face-detection') {
      // H-6 Fix: Only enqueue images that have no face embedding records yet
      const res = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files
        WHERE mime_type LIKE 'image/%'
        AND NOT EXISTS (SELECT 1 FROM face_embeddings fe WHERE fe.media_id = media_files.id)`);
      for (const row of res.rows) {
        await faceDetectionQueue.add('detect-faces', {
          mediaId: row.id,
          fullPath: path.resolve(process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro'), row.folder_path || '', row.file_name),
          mimeType: row.mime_type
        });
      }
    } else if (name === 'facial-recognition') {
      // H-6 Fix: Only enqueue images that have unclustered faces
      const res = await query(`SELECT DISTINCT m.id, m.folder_path, m.file_name, m.mime_type
        FROM media_files m
        JOIN face_embeddings fe ON fe.media_id = m.id
        WHERE fe.person_id IS NULL`);
      for (const row of res.rows) {
        await facialRecognitionQueue.add('recognize-faces', {
          mediaId: row.id,
          fullPath: path.resolve(process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro'), row.folder_path || '', row.file_name),
          mimeType: row.mime_type
        });
      }
    }

    return reply.send({ success: true, message: `Triggered queue '${name}'` });
  });
}
