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
import { redis } from '../../config/redis';
import path from 'path';

const MEDIA_ROOT = () => process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro');
const CACHE_ROOT = () => process.env.CACHE_ROOT || path.resolve(process.cwd(), '../volumes/cache_rw');

// Batch-add jobs to a BullMQ queue in chunks to avoid flooding Redis
// with a single giant pipeline for 100k+ items.
async function addBulkBatched(
  queue: any,
  jobs: { name: string; data: any; opts?: any }[],
  batchSize = 500
) {
  for (let i = 0; i < jobs.length; i += batchSize) {
    await queue.addBulk(jobs.slice(i, i + batchSize));
  }
}

// Record when processing was triggered so we can calculate throughput/ETA.
async function recordEtaStart(name: string, pendingCount: number) {
  await redis.set(`queue:eta:start_time:${name}`, Date.now().toString(), 'EX', 86400);
  await redis.set(`queue:eta:start_pending:${name}`, pendingCount.toString(), 'EX', 86400);
}

// Compute ETA in seconds given current stats. Returns null if not enough data yet.
async function computeEta(name: string, remaining: number): Promise<{ etaSeconds: number | null; ratePerMin: number | null }> {
  try {
    const [startTimeStr, startPendingStr] = await Promise.all([
      redis.get(`queue:eta:start_time:${name}`),
      redis.get(`queue:eta:start_pending:${name}`)
    ]);
    if (!startTimeStr || !startPendingStr) return { etaSeconds: null, ratePerMin: null };

    const elapsed = (Date.now() - parseInt(startTimeStr)) / 1000; // seconds
    if (elapsed < 30) return { etaSeconds: null, ratePerMin: null }; // too early for a stable estimate

    const startPending = parseInt(startPendingStr);
    const processedSinceStart = startPending - remaining;
    if (processedSinceStart <= 0) return { etaSeconds: null, ratePerMin: null };

    const ratePerSec = processedSinceStart / elapsed;
    const ratePerMin = Math.round(ratePerSec * 60);
    const etaSeconds = remaining > 0 ? Math.round(remaining / ratePerSec) : 0;
    return { etaSeconds, ratePerMin };
  } catch {
    return { etaSeconds: null, ratePerMin: null };
  }
}

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
  // Stats are cached in Redis for 6 seconds to avoid hammering Postgres on every poll cycle.
  fastify.get('/api/admin/queues', async (request, reply) => {
    const STATS_CACHE_KEY = 'queue:stats:cache';
    const cached = await redis.get(STATS_CACHE_KEY);
    if (cached) {
      return reply.send(JSON.parse(cached));
    }

    const stats: Record<string, any> = {};
    const currentMode = await getExecutionMode();

    // Run all DB count queries in parallel instead of sequentially
    const [
      scannerRes,
      metadataRes,
      thumbnailRes,
      videoRes,
      smartSearchRes,
      faceDetectionRes,
      facialRecognitionRes,
      peopleTotalRes,
    ] = await Promise.all([
      query('SELECT COUNT(DISTINCT folder_path)::int as folders, COUNT(*)::int as files FROM media_files').catch(() => ({ rows: [{ folders: 0, files: 0 }] })),
      query('SELECT COUNT(*)::int as total, COUNT(exif_json)::int as completed FROM media_files').catch(() => ({ rows: [{ total: 0, completed: 0 }] })),
      query(`SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE has_1080p AND has_480p)::int as completed FROM media_files WHERE mime_type LIKE 'image/%'`).catch(() => ({ rows: [{ total: 0, completed: 0 }] })),
      query(`SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE has_480p IS NOT NULL)::int as completed FROM media_files WHERE mime_type LIKE 'video/%'`).catch(() => ({ rows: [{ total: 0, completed: 0 }] })),
      query(`SELECT COUNT(*)::int as total, COUNT(clip_embedding)::int as completed FROM media_files WHERE mime_type LIKE 'image/%'`).catch(() => ({ rows: [{ total: 0, completed: 0 }] })),
      query(`SELECT (SELECT COUNT(*)::int FROM media_files WHERE mime_type LIKE 'image/%') as total, COALESCE((SELECT COUNT(DISTINCT media_id)::int FROM face_embeddings), 0) as completed`).catch(() => ({ rows: [{ total: 0, completed: 0 }] })),
      query(`SELECT (SELECT COUNT(*)::int FROM face_embeddings) as total, (SELECT COUNT(*)::int FROM face_embeddings WHERE person_id IS NOT NULL) as completed`).catch(() => ({ rows: [{ total: 0, completed: 0 }] })),
      query(`SELECT COALESCE((SELECT COUNT(*)::int FROM people), 0) AS total`).catch(() => ({ rows: [{ total: 0 }] })),
    ]);

    // Face thumbnail disk count — cached separately with a 30s TTL to avoid per-poll readdir
    const FACE_THUMB_COUNT_KEY = 'queue:face_thumb_disk_count';
    let faceThumbnailCompleted = 0;
    const cachedFaceCount = await redis.get(FACE_THUMB_COUNT_KEY);
    if (cachedFaceCount !== null) {
      faceThumbnailCompleted = parseInt(cachedFaceCount);
    } else {
      try {
        const { readdir } = await import('fs/promises');
        const facesDir = path.join(CACHE_ROOT(), 'faces');
        const files = await readdir(facesDir);
        faceThumbnailCompleted = files.filter(f => f.endsWith('.webp')).length;
        await redis.set(FACE_THUMB_COUNT_KEY, faceThumbnailCompleted.toString(), 'EX', 30);
      } catch {
        faceThumbnailCompleted = 0;
      }
    }

    const dbStats: Record<string, { total: number; completed: number; extra?: any }> = {
      scanner: {
        total: (scannerRes.rows[0].folders || 0) + 0,
        completed: scannerRes.rows[0].folders || 0,
        extra: { folders: scannerRes.rows[0].folders, files: scannerRes.rows[0].files }
      },
      metadata:          { total: metadataRes.rows[0].total,          completed: metadataRes.rows[0].completed },
      thumbnail:         { total: thumbnailRes.rows[0].total,         completed: thumbnailRes.rows[0].completed },
      video:             { total: videoRes.rows[0].total,             completed: videoRes.rows[0].completed },
      'smart-search':    { total: smartSearchRes.rows[0].total,       completed: smartSearchRes.rows[0].completed },
      'face-detection':  { total: faceDetectionRes.rows[0].total,     completed: faceDetectionRes.rows[0].completed },
      'facial-recognition': { total: facialRecognitionRes.rows[0].total, completed: facialRecognitionRes.rows[0].completed },
      'face-thumbnail':  { total: peopleTotalRes.rows[0].total,       completed: faceThumbnailCompleted },
    };

    // Fetch BullMQ state for all queues in parallel
    await Promise.all(Object.entries(queues).map(async ([name, q]) => {
      const [bullmqCounts, isPaused, activeJobsRaw] = await Promise.all([
        q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused'),
        q.isPaused(),
        q.getJobs(['active']),
      ]);

      const db = dbStats[name] || { total: 0, completed: 0 };
      if (name === 'scanner') {
        (q as any).extraStats = db.extra;
        db.total = (bullmqCounts.waiting || 0) + (bullmqCounts.active || 0) + (bullmqCounts.failed || 0) + db.completed;
      }

      const active = (bullmqCounts.active || 0) + (bullmqCounts.delayed || 0);
      const failed = bullmqCounts.failed || 0;
      const remaining = Math.max(0, db.total - db.completed);
      const waiting = Math.max(0, remaining - active);
      const progress = db.total > 0 ? Math.round((db.completed / db.total) * 100) : 0;

      // ETA calculation
      const { etaSeconds, ratePerMin } = await computeEta(name, remaining);

      // Active job targets — use data.fullPath directly; only fall back to DB for mediaId-only jobs
      const activeJobs = activeJobsRaw.map((j: any) => {
        const target = j?.data?.fullPath || j?.data?.folderPath || j?.data?.mediaId || 'Processing...';
        return { id: j?.id, target };
      });

      stats[name] = {
        counts: { waiting, active, completed: db.completed, failed, total: db.total },
        bullmq: { waiting: bullmqCounts.waiting || 0, active },
        isPaused,
        activeJobs,
        progress,
        extra: (q as any).extraStats,
        eta: { etaSeconds, ratePerMin },
      };
    }));

    const result = { queues: stats, mode: currentMode };
    // Cache for 6 seconds (shorter than the 10s poll interval so data is always fresh)
    await redis.set(STATS_CACHE_KEY, JSON.stringify(result), 'EX', 6);
    return reply.send(result);
  });

  // POST /api/admin/queues/:name/pause
  fastify.post('/api/admin/queues/:name/pause', async (request, reply) => {
    const { name } = request.params as any;
    const q = queues[name];
    if (!q) return reply.status(404).send({ error: `Queue '${name}' not found` });
    await q.pause();
    await redis.del('queue:stats:cache');
    return reply.send({ success: true });
  });

  // POST /api/admin/queues/:name/resume
  fastify.post('/api/admin/queues/:name/resume', async (request, reply) => {
    const { name } = request.params as any;
    const q = queues[name];
    if (!q) return reply.status(404).send({ error: `Queue '${name}' not found` });
    await q.resume();
    await redis.del('queue:stats:cache');
    return reply.send({ success: true });
  });

  // POST /api/admin/queues/:name/stop
  fastify.post('/api/admin/queues/:name/stop', async (request, reply) => {
    const { name } = request.params as any;
    const q = queues[name];
    if (!q) return reply.status(404).send({ error: `Queue '${name}' not found` });
    // M-2 Fix: Pause and drain. Do NOT resume — admin must explicitly click Resume to restart.
    await q.pause();
    await q.drain(true);
    await q.clean(0, 10000, 'active');
    await redis.del('queue:stats:cache');
    return reply.send({ success: true });
  });

  // POST /api/admin/queues/:name/clean
  fastify.post('/api/admin/queues/:name/clean', async (request, reply) => {
    const { name } = request.params as any;
    const { type } = request.body as any;
    const q = queues[name];
    if (!q) return reply.status(404).send({ error: `Queue '${name}' not found` });
    await q.clean(0, 1000, type || 'failed');
    await redis.del('queue:stats:cache');
    return reply.send({ success: true });
  });

  // POST /api/admin/queues/:name/trigger
  // Uses addBulk batching instead of sequential await queue.add() to avoid blocking
  // the event loop when enqueueing tens of thousands of jobs.
  fastify.post('/api/admin/queues/:name/trigger', async (request, reply) => {
    const { name } = request.params as any;
    const q = queues[name];
    if (!q) return reply.status(404).send({ error: `Queue '${name}' not found` });

    await q.clean(0, 10000, 'active');
    await q.resume();
    await redis.del('queue:stats:cache');

    const mediaRoot = MEDIA_ROOT();

    if (name === 'scanner') {
      const { ScannerService } = await import('../scanner/scanner.service');
      ScannerService.scanAllDirectories('').catch(console.error);

    } else if (name === 'metadata') {
      const res = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files WHERE exif_json IS NULL`);
      await recordEtaStart(name, res.rows.length);
      await addBulkBatched(metadataQueue, res.rows.map(row => ({
        name: 'extract-metadata',
        data: { mediaId: row.id, fullPath: path.resolve(mediaRoot, row.folder_path || '', row.file_name), mimeType: row.mime_type }
      })));

    } else if (name === 'thumbnail') {
      const res = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'image/%' AND (NOT has_1080p OR NOT has_480p)`);
      await recordEtaStart(name, res.rows.length);
      await addBulkBatched(thumbnailQueue, res.rows.map(row => ({
        name: 'generate-thumbnail',
        data: { mediaId: row.id, fullPath: path.resolve(mediaRoot, row.folder_path || '', row.file_name), mimeType: row.mime_type }
      })));

    } else if (name === 'video') {
      const res = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'video/%' AND has_480p IS NULL`);
      await recordEtaStart(name, res.rows.length);
      await addBulkBatched(videoQueue, res.rows.map(row => ({
        name: 'process-video',
        data: { mediaId: row.id, fullPath: path.resolve(mediaRoot, row.folder_path || '', row.file_name), mimeType: row.mime_type }
      })));

    } else if (name === 'smart-search') {
      const res = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files WHERE clip_embedding IS NULL`);
      await recordEtaStart(name, res.rows.length);
      await addBulkBatched(smartSearchQueue, res.rows.map(row => ({
        name: 'generate-smart-search',
        data: { mediaId: row.id, fullPath: path.resolve(mediaRoot, row.folder_path || '', row.file_name), mimeType: row.mime_type }
      })));

    } else if (name === 'face-detection') {
      const res = await query(`SELECT id, folder_path, file_name, mime_type FROM media_files
        WHERE mime_type LIKE 'image/%'
        AND NOT EXISTS (SELECT 1 FROM face_embeddings fe WHERE fe.media_id = media_files.id)`);
      await recordEtaStart(name, res.rows.length);
      await addBulkBatched(faceDetectionQueue, res.rows.map(row => ({
        name: 'detect-faces',
        data: { mediaId: row.id, fullPath: path.resolve(mediaRoot, row.folder_path || '', row.file_name), mimeType: row.mime_type }
      })));

    } else if (name === 'facial-recognition') {
      const res = await query(`SELECT DISTINCT m.id, m.folder_path, m.file_name, m.mime_type
        FROM media_files m
        JOIN face_embeddings fe ON fe.media_id = m.id
        WHERE fe.person_id IS NULL`);
      await recordEtaStart(name, res.rows.length);
      await addBulkBatched(facialRecognitionQueue, res.rows.map(row => ({
        name: 'recognize-faces',
        data: { mediaId: row.id, fullPath: path.resolve(mediaRoot, row.folder_path || '', row.file_name), mimeType: row.mime_type }
      })));
    }

    return reply.send({ success: true, message: `Triggered queue '${name}'` });
  });
}
