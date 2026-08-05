import { FastifyInstance } from 'fastify';
import { QueueEvents } from 'bullmq';
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
  facialRecognitionQueue,
  faceThumbnailQueue
} from '../../queue';
import { query } from '../../config/db';
import { redis } from '../../config/redis';
import path from 'path';

const MEDIA_ROOT = () => process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro');
const CACHE_ROOT = () => process.env.CACHE_ROOT || path.resolve(process.cwd(), '../volumes/cache_rw');

const ENQUEUE_PAGE_SIZE = 500;

// Stream DB rows in pages and add to BullMQ without ever holding all rows in memory.
// Returns total count of jobs enqueued.
async function streamEnqueue(
  bullQueue: any,
  countSql: string,
  pageSql: string, // must accept $1=limit $2=offset
  rowToJob: (row: any) => { name: string; data: any; opts?: any }
): Promise<number> {
  const countRes = await query(countSql);
  const total = parseInt(countRes.rows[0].count ?? '0');
  if (total === 0) return 0;

  let offset = 0;
  while (offset < total) {
    const page = await query(pageSql, [ENQUEUE_PAGE_SIZE, offset]);
    if (page.rows.length === 0) break;
    await bullQueue.addBulk(page.rows.map(rowToJob));
    offset += page.rows.length;
  }
  return total;
}

// Record when processing was triggered so we can calculate throughput/ETA.
async function recordEtaStart(name: string, pendingCount: number) {
  await redis.set(`queue:eta:start_time:${name}`, Date.now().toString(), 'EX', 86400);
  await redis.set(`queue:eta:start_pending:${name}`, pendingCount.toString(), 'EX', 86400);
}

// Compute ETA in seconds given current stats. Returns null if not enough data yet.
async function computeEta(name: string, remaining: number): Promise<{ etaSeconds: number | null; ratePerMin: number | null; elapsedSeconds: number | null }> {
  try {
    const [startTimeStr, startPendingStr] = await Promise.all([
      redis.get(`queue:eta:start_time:${name}`),
      redis.get(`queue:eta:start_pending:${name}`)
    ]);
    if (!startTimeStr || !startPendingStr) return { etaSeconds: null, ratePerMin: null, elapsedSeconds: null };

    const elapsed = (Date.now() - parseInt(startTimeStr)) / 1000; // seconds
    const elapsedSeconds = Math.round(elapsed);
    if (elapsed < 30) return { etaSeconds: null, ratePerMin: null, elapsedSeconds };

    const startPending = parseInt(startPendingStr);
    const processedSinceStart = startPending - remaining;
    if (processedSinceStart <= 0) return { etaSeconds: null, ratePerMin: null, elapsedSeconds };

    const ratePerSec = processedSinceStart / elapsed;
    const ratePerMin = Math.round(ratePerSec * 60);
    const etaSeconds = remaining > 0 ? Math.round(remaining / ratePerSec) : 0;
    return { etaSeconds, ratePerMin, elapsedSeconds };
  } catch {
    return { etaSeconds: null, ratePerMin: null, elapsedSeconds: null };
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
    const { mode } = request.body as { mode: 'pipeline' | 'batch' };
    if (mode !== 'pipeline' && mode !== 'batch') {
      return reply.status(400).send({ error: "Mode must be 'pipeline' or 'batch'" });
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
      const waiting = Math.max(0, remaining - active - failed);
      const progress = db.total > 0 ? Math.round((db.completed / db.total) * 100) : 0;

      // ETA calculation
      const { etaSeconds, ratePerMin, elapsedSeconds } = await computeEta(name, remaining);

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
        eta: { etaSeconds, ratePerMin, elapsedSeconds },
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
    // Pause the queue so no new jobs are picked up
    await q.pause();
    // drain(false) removes waiting jobs without waiting for active jobs to finish.
    // This returns instantly even if workers are mid-job (they'll finish gracefully).
    q.drain(false).catch(() => {});
    await q.clean(0, 100000, 'active');
    
    // Clear ETA timers so UI stops thinking it is running
    await redis.del(`queue:eta:start_time:${name}`);
    await redis.del(`queue:eta:start_pending:${name}`);
    
    // If we stop any queue, we should probably clear the batch running state to be safe
    await redis.del('queue:batch:running');
    
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

    const toJob = (jobName: string) => (row: any) => ({
      name: jobName,
      data: { mediaId: row.id, fullPath: path.resolve(mediaRoot, row.folder_path || '', row.file_name), mimeType: row.mime_type },
      opts: { removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } }
    });

    if (name === 'scanner') {
      const { ScannerService } = await import('../scanner/scanner.service');
      ScannerService.scanAllDirectories('').catch(console.error);

    } else if (name === 'metadata') {
      const total = await streamEnqueue(
        metadataQueue,
        `SELECT COUNT(*)::text as count FROM media_files WHERE exif_json IS NULL`,
        `SELECT id, folder_path, file_name, mime_type FROM media_files WHERE exif_json IS NULL ORDER BY id LIMIT $1 OFFSET $2`,
        toJob('extract-metadata')
      );
      await recordEtaStart(name, total);

    } else if (name === 'thumbnail') {
      const total = await streamEnqueue(
        thumbnailQueue,
        `SELECT COUNT(*)::text as count FROM media_files WHERE mime_type LIKE 'image/%' AND (NOT has_1080p OR NOT has_480p)`,
        `SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'image/%' AND (NOT has_1080p OR NOT has_480p) ORDER BY id LIMIT $1 OFFSET $2`,
        toJob('generate-thumbnail')
      );
      await recordEtaStart(name, total);

    } else if (name === 'video') {
      const total = await streamEnqueue(
        videoQueue,
        `SELECT COUNT(*)::text as count FROM media_files WHERE mime_type LIKE 'video/%' AND has_480p IS NULL`,
        `SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'video/%' AND has_480p IS NULL ORDER BY id LIMIT $1 OFFSET $2`,
        toJob('process-video')
      );
      await recordEtaStart(name, total);

    } else if (name === 'smart-search') {
      const total = await streamEnqueue(
        smartSearchQueue,
        `SELECT COUNT(*)::text as count FROM media_files WHERE clip_embedding IS NULL`,
        `SELECT id, folder_path, file_name, mime_type FROM media_files WHERE clip_embedding IS NULL ORDER BY id LIMIT $1 OFFSET $2`,
        toJob('generate-smart-search')
      );
      await recordEtaStart(name, total);

    } else if (name === 'face-detection') {
      const total = await streamEnqueue(
        faceDetectionQueue,
        `SELECT COUNT(*)::text as count FROM media_files WHERE mime_type LIKE 'image/%' AND NOT EXISTS (SELECT 1 FROM face_embeddings fe WHERE fe.media_id = media_files.id)`,
        `SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'image/%' AND NOT EXISTS (SELECT 1 FROM face_embeddings fe WHERE fe.media_id = media_files.id) ORDER BY id LIMIT $1 OFFSET $2`,
        toJob('detect-faces')
      );
      await recordEtaStart(name, total);

    } else if (name === 'facial-recognition') {
      const total = await streamEnqueue(
        facialRecognitionQueue,
        `SELECT COUNT(DISTINCT m.id)::text as count FROM media_files m JOIN face_embeddings fe ON fe.media_id = m.id WHERE fe.person_id IS NULL`,
        `SELECT DISTINCT m.id, m.folder_path, m.file_name, m.mime_type FROM media_files m JOIN face_embeddings fe ON fe.media_id = m.id WHERE fe.person_id IS NULL ORDER BY m.id LIMIT $1 OFFSET $2`,
        toJob('recognize-faces')
      );
      await recordEtaStart(name, total);
    }

    return reply.send({ success: true, message: `Triggered queue '${name}'` });
  });

  // POST /api/admin/queues/start-all-batch
  // Batch mode: runs stages serially. Each stage must fully drain before the next begins.
  // Stage order: metadata → (thumbnail + video) → smart-search → face-detection → facial-recognition → face-thumbnail
  // Returns immediately; the chain runs in the background.
  fastify.post('/api/admin/queues/start-all-batch', async (request, reply) => {
    const BATCH_RUNNING_KEY = 'queue:batch:running';
    const alreadyRunning = await redis.set(BATCH_RUNNING_KEY, '1', 'EX', 3600 * 12, 'NX');
    if (!alreadyRunning) {
      return reply.status(409).send({ error: 'A batch run is already in progress.' });
    }

    reply.send({ success: true, message: 'Batch processing started. Stages will run serially.' });

    // Run the chain fully in the background so we don't block the HTTP response
    setImmediate(async () => {
      const mediaRoot = MEDIA_ROOT();
      const toJob = (jobName: string) => (row: any) => ({
        name: jobName,
        data: { mediaId: row.id, fullPath: path.resolve(mediaRoot, row.folder_path || '', row.file_name), mimeType: row.mime_type },
        opts: { removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } }
      });

      // Helper: wait until a queue has zero waiting + active jobs.
      // Uses a standard polling interval. The previous memory leak was
      // caused by enqueueing thousands of jobs at once, NOT by setInterval.
      // QueueEvents was spamming getJobCounts on every job completion causing SIGABRT.
      async function drainWait(q: any, name: string): Promise<void> {
        const checkDrained = async () => {
          const counts = await q.getJobCounts('waiting', 'active');
          return (counts.waiting || 0) === 0 && (counts.active || 0) === 0;
        };

        if (await checkDrained()) {
          await redis.del(`queue:eta:start_time:${name}`);
          await redis.del(`queue:eta:start_pending:${name}`);
          return;
        }
        console.log(`[Batch] Waiting for ${name} to drain...`);

        return new Promise<void>((resolve, reject) => {
          let interval: NodeJS.Timeout;
          
          const timeout = setTimeout(() => {
            clearInterval(interval);
            console.log(`[Batch] ${name} drain timeout reached.`);
            resolve();
          }, 30 * 60 * 1000);

          interval = setInterval(async () => {
            try {
              if (!(await redis.get(BATCH_RUNNING_KEY))) {
                clearInterval(interval);
                clearTimeout(timeout);
                reject(new Error('Batch aborted by user'));
                return;
              }

              if (await checkDrained()) {
                clearInterval(interval);
                clearTimeout(timeout);
                await redis.del(`queue:eta:start_time:${name}`);
                await redis.del(`queue:eta:start_pending:${name}`);
                console.log(`[Batch] ${name} drained.`);
                resolve();
              }
            } catch (err) {
              clearInterval(interval);
              clearTimeout(timeout);
              reject(err);
            }
          }, 3000);
        });
      }

      try {
        // Pause all queues upfront so they visually display as QUEUED (BATCH) in the UI
        await Promise.all(Object.values(queues).map(q => q.pause()));
        await redis.del('queue:stats:cache');

        // Stage 1: Scanner
        console.log('[Batch] Stage 1: Scanner');
        await scannerQueue.resume();
        const { ScannerService } = await import('../scanner/scanner.service');
        await ScannerService.scanAllDirectories('');
        await drainWait(scannerQueue, 'scanner');

        // Stage 2: Metadata
        console.log('[Batch] Stage 2: Metadata');
        await metadataQueue.resume();
        const metaTotal = await streamEnqueue(
          metadataQueue,
          `SELECT COUNT(*)::text as count FROM media_files WHERE exif_json IS NULL`,
          `SELECT id, folder_path, file_name, mime_type FROM media_files WHERE exif_json IS NULL ORDER BY id LIMIT $1 OFFSET $2`,
          toJob('extract-metadata')
        );
        await recordEtaStart('metadata', metaTotal);
        await drainWait(metadataQueue, 'metadata');

        // Stage 3: Thumbnail + Video (run in parallel, both must drain)
        console.log('[Batch] Stage 3: Thumbnails + Video (parallel)');
        await thumbnailQueue.resume();
        await videoQueue.resume();
        const [thumbTotal, videoTotal] = await Promise.all([
          streamEnqueue(
            thumbnailQueue,
            `SELECT COUNT(*)::text as count FROM media_files WHERE mime_type LIKE 'image/%' AND (NOT has_1080p OR NOT has_480p)`,
            `SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'image/%' AND (NOT has_1080p OR NOT has_480p) ORDER BY id LIMIT $1 OFFSET $2`,
            toJob('generate-thumbnail')
          ),
          streamEnqueue(
            videoQueue,
            `SELECT COUNT(*)::text as count FROM media_files WHERE mime_type LIKE 'video/%' AND has_480p IS NULL`,
            `SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'video/%' AND has_480p IS NULL ORDER BY id LIMIT $1 OFFSET $2`,
            toJob('process-video')
          )
        ]);
        await recordEtaStart('thumbnail', thumbTotal);
        await recordEtaStart('video', videoTotal);
        await Promise.all([drainWait(thumbnailQueue, 'thumbnail'), drainWait(videoQueue, 'video')]);

        // Stage 4: Smart Search
        console.log('[Batch] Stage 4: Smart Search');
        await smartSearchQueue.resume();
        const ssTotal = await streamEnqueue(
          smartSearchQueue,
          `SELECT COUNT(*)::text as count FROM media_files WHERE clip_embedding IS NULL`,
          `SELECT id, folder_path, file_name, mime_type FROM media_files WHERE clip_embedding IS NULL ORDER BY id LIMIT $1 OFFSET $2`,
          toJob('generate-smart-search')
        );
        await recordEtaStart('smart-search', ssTotal);
        await drainWait(smartSearchQueue, 'smart-search');

        // Stage 5: Face Detection
        console.log('[Batch] Stage 5: Face Detection');
        await faceDetectionQueue.resume();
        const fdTotal = await streamEnqueue(
          faceDetectionQueue,
          `SELECT COUNT(*)::text as count FROM media_files WHERE mime_type LIKE 'image/%' AND NOT EXISTS (SELECT 1 FROM face_embeddings fe WHERE fe.media_id = media_files.id)`,
          `SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'image/%' AND NOT EXISTS (SELECT 1 FROM face_embeddings fe WHERE fe.media_id = media_files.id) ORDER BY id LIMIT $1 OFFSET $2`,
          toJob('detect-faces')
        );
        await recordEtaStart('face-detection', fdTotal);
        await drainWait(faceDetectionQueue, 'face-detection');

        // Stage 6: Facial Recognition (recluster all)
        console.log('[Batch] Stage 6: Facial Recognition');
        await facialRecognitionQueue.resume();
        const frTotal = await streamEnqueue(
          facialRecognitionQueue,
          `SELECT COUNT(DISTINCT m.id)::text as count FROM media_files m JOIN face_embeddings fe ON fe.media_id = m.id WHERE fe.person_id IS NULL`,
          `SELECT DISTINCT m.id, m.folder_path, m.file_name, m.mime_type FROM media_files m JOIN face_embeddings fe ON fe.media_id = m.id WHERE fe.person_id IS NULL ORDER BY m.id LIMIT $1 OFFSET $2`,
          toJob('recognize-faces')
        );
        await recordEtaStart('facial-recognition', frTotal);
        await drainWait(facialRecognitionQueue, 'facial-recognition');

        // Stage 7: Face Thumbnails
        console.log('[Batch] Stage 7: Face Thumbnails');
        await faceThumbnailQueue.resume();
        const ftTotal = await streamEnqueue(
          faceThumbnailQueue,
          `SELECT COUNT(DISTINCT fe.media_id)::text as count FROM face_embeddings fe JOIN people p ON p.id = fe.person_id WHERE fe.person_id IS NOT NULL`,
          `SELECT DISTINCT fe.media_id FROM face_embeddings fe JOIN people p ON p.id = fe.person_id WHERE fe.person_id IS NOT NULL ORDER BY fe.media_id LIMIT $1 OFFSET $2`,
          (row) => ({
            name: 'generate-face-thumbnails',
            data: { mediaId: row.media_id },
            opts: { jobId: `face-thumb-${row.media_id}`, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } }
          })
        );
        await recordEtaStart('face-thumbnail', ftTotal);
        await drainWait(faceThumbnailQueue, 'face-thumbnail');

        console.log('[Batch] All stages complete!');
      } catch (err) {
        console.error('[Batch] Batch processing failed:', err);
      } finally {
        await redis.del(BATCH_RUNNING_KEY);
        await redis.del('queue:stats:cache');
      }
    });
  });

  // GET /api/admin/queues/batch-status — check if a batch run is in progress
  fastify.get('/api/admin/queues/batch-status', async (request, reply) => {
    const running = await redis.get('queue:batch:running');
    return reply.send({ running: !!running });
  });
}
