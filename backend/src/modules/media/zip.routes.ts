import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZipArchive } from 'archiver';
import { query } from '../../config/db';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { verifyFolderAccess } from '../../utils/auth';
import { WatermarkService } from './watermark.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { getThrottleLimits, BandwidthThrottler } from '../../utils/throttle';

const MEDIA_ROOT = process.env.MEDIA_ROOT || '/app/media';
const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || (fs.existsSync('/app/cache') ? '/app/cache' : path.resolve(process.cwd(), '../volumes/cache_rw')));
const TEMP_ZIP_DIR = path.join(CACHE_ROOT, 'temp_zips');

try {
  if (!fs.existsSync(TEMP_ZIP_DIR)) {
    fs.mkdirSync(TEMP_ZIP_DIR, { recursive: true });
  }
} catch (e) {
  console.error('[ZIP] Failed to create TEMP_ZIP_DIR:', e);
}

interface ZipPart {
  partIndex: number;
  filename: string;
  filePath: string;
  totalFiles: number;
  processedFiles: number;
  sizeBytes: number;
  status: 'pending' | 'zipping' | 'ready' | 'error';
}

interface ZipJob {
  id: string;
  folderPath: string;
  baseFilename: string;
  partSize: 'single' | '2gb' | '4gb' | '8gb';
  totalParts: number;
  currentPartIndex: number;
  parts: ZipPart[];
  status: 'pending' | 'zipping' | 'ready' | 'error';
  progress: number;
  processedFiles: number;
  totalFiles: number;
  totalBytes: number;
  error?: string;
  createdAt: number;
  deleteTimer?: NodeJS.Timeout;
  shareToken?: string;
  watermark?: string;
  contentFingerprint?: string;
}

const zipJobs = new Map<string, ZipJob>();

function scheduleJobDeletion(jobId: string, delayMs = 5 * 60 * 1000) {
  const job = zipJobs.get(jobId);
  if (!job) return;
  if (job.deleteTimer) clearTimeout(job.deleteTimer);
  job.deleteTimer = setTimeout(() => {
    try {
      if (job.parts && job.parts.length > 0) {
        for (const part of job.parts) {
          if (fs.existsSync(part.filePath)) {
            fs.unlinkSync(part.filePath);
          }
        }
      }
    } catch (err) {
      console.error(`[ZIP] Failed to delete temp zip parts for job ${job.id}:`, err);
    }
    zipJobs.delete(jobId);
  }, delayMs);
}

function cleanupStaleZips() {
  try {
    if (fs.existsSync(TEMP_ZIP_DIR)) {
      const files = fs.readdirSync(TEMP_ZIP_DIR);
      const now = Date.now();
      for (const file of files) {
        const fp = path.join(TEMP_ZIP_DIR, file);
        try {
          const stat = fs.statSync(fp);
          // Delete if older than 15 minutes
          if (now - stat.mtimeMs > 15 * 60 * 1000) {
            fs.unlinkSync(fp);
          }
        } catch {}
      }
    }
  } catch (e) {}
}

cleanupStaleZips();
setInterval(cleanupStaleZips, 5 * 60 * 1000);

const PART_SIZE_MAP: Record<string, number> = {
  '2gb': 2 * 1024 * 1024 * 1024,
  '4gb': 4 * 1024 * 1024 * 1024,
  '8gb': 8 * 1024 * 1024 * 1024,
};

export async function zipRoutes(fastify: FastifyInstance) {
  // 1. Prepare / Pre-zip endpoint
  fastify.post('/api/zip/prepare', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body as any) || {};
    const queryParams = (request.query as any) || {};
    const folderPath = decodeURIComponent(body.folderPath ?? queryParams.folderPath ?? '');
    const shareToken = body.shareToken || queryParams.shareToken;
    const watermark = body.watermark || queryParams.watermark;
    const partSize = (body.partSize || queryParams.partSize || 'single') as 'single' | '2gb' | '4gb' | '8gb';

    if (shareToken && !(request.query as any)?.shareToken) {
      (request.query as any).shareToken = shareToken;
    }

    if (!(await verifyFolderAccess(request, reply, folderPath))) return;

    const effectiveTemplate = await WatermarkService.getEffectiveTemplateForShare(shareToken);
    const shouldWatermark = watermark === 'true' || Boolean(effectiveTemplate?.apply_to_downloads);

    const result = folderPath === ''
      ? await query(
          `SELECT id, folder_path, file_name, mime_type, size_bytes, created_at,
                  exif_json->>'DateTimeOriginal' as captured_at,
                  exif_json->>'Make' as camera_make,
                  exif_json->>'Model' as camera_model,
                  exif_json->>'LensModel' as lens_model,
                  exif_json->>'ISO' as iso,
                  exif_json->>'ExposureTime' as shutter_speed,
                  exif_json->>'FNumber' as f_number,
                  exif_json->>'Copyright' as copyright
           FROM media_files ORDER BY folder_path ASC, file_name ASC`
        )
      : await query(
          `SELECT id, folder_path, file_name, mime_type, size_bytes, created_at,
                  exif_json->>'DateTimeOriginal' as captured_at,
                  exif_json->>'Make' as camera_make,
                  exif_json->>'Model' as camera_model,
                  exif_json->>'LensModel' as lens_model,
                  exif_json->>'ISO' as iso,
                  exif_json->>'ExposureTime' as shutter_speed,
                  exif_json->>'FNumber' as f_number,
                  exif_json->>'Copyright' as copyright
           FROM media_files WHERE folder_path = $1 OR folder_path LIKE $1 || '/%' ORDER BY folder_path ASC, file_name ASC`, 
          [folderPath]
        );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'No files found in this folder.' });
    }

    const existingFiles: Array<any> = [];
    for (const file of result.rows) {
      const fullPath = path.join(MEDIA_ROOT, file.folder_path, file.file_name);
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        existingFiles.push({
          ...file,
          fullPath,
          fileName: file.file_name,
          folderPath: file.folder_path,
          mimeType: file.mime_type,
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs
        });
      }
    }

    if (existingFiles.length === 0) {
      return reply.status(404).send({ error: 'No files found on disk for this folder.' });
    }

    // Compute content fingerprint incorporating folder files and partSize
    const hash = crypto.createHash('md5');
    hash.update(`partSize:${partSize}\n`);
    for (const file of existingFiles) {
      hash.update(`${file.folderPath}/${file.fileName}:${file.sizeBytes}:${file.mtimeMs}\n`);
    }
    const currentFingerprint = hash.digest('hex');

    // Smart check: Reuse existing temporary zip parts if content & part size haven't changed
    for (const [id, existingJob] of zipJobs.entries()) {
      if (existingJob.folderPath === folderPath && existingJob.watermark === watermark) {
        if (existingJob.contentFingerprint === currentFingerprint) {
          const allPartsExist = existingJob.parts && existingJob.parts.length > 0 &&
            existingJob.parts.every(p => fs.existsSync(p.filePath));

          if (allPartsExist) {
            if (existingJob.status === 'ready') {
              console.log(`[ZIP] Reusing existing temp zip(s) for "${folderPath}". Resetting 5-minute deletion timer.`);
              scheduleJobDeletion(id, 5 * 60 * 1000);
              return reply.send({
                jobId: id,
                totalFiles: existingJob.totalFiles,
                totalParts: existingJob.totalParts,
                partSize: existingJob.partSize,
                reused: true
              });
            } else if (existingJob.status === 'zipping') {
              console.log(`[ZIP] Reusing in-progress zip job for "${folderPath}".`);
              return reply.send({
                jobId: id,
                totalFiles: existingJob.totalFiles,
                totalParts: existingJob.totalParts,
                partSize: existingJob.partSize,
                reused: true
              });
            }
          }
        } else {
          // Content or part size has changed; clean up old job parts
          try {
            if (existingJob.parts) {
              for (const p of existingJob.parts) {
                if (fs.existsSync(p.filePath)) fs.unlinkSync(p.filePath);
              }
            }
          } catch {}
          zipJobs.delete(id);
        }
      }
    }

    // Partition files into standalone parts based on chosen size threshold
    const maxBytesPerPart = PART_SIZE_MAP[partSize] || Infinity;
    const partsFiles: Array<typeof existingFiles> = [];
    let currentPart: typeof existingFiles = [];
    let currentPartBytes = 0;

    for (const file of existingFiles) {
      if (currentPart.length > 0 && (currentPartBytes + file.sizeBytes > maxBytesPerPart)) {
        partsFiles.push(currentPart);
        currentPart = [];
        currentPartBytes = 0;
      }
      currentPart.push(file);
      currentPartBytes += file.sizeBytes;
    }
    if (currentPart.length > 0) {
      partsFiles.push(currentPart);
    }

    const totalParts = partsFiles.length;
    const baseName = (folderPath ? folderPath.split('/').pop() : 'Home_Photos') || 'Photos';
    const totalPadded = String(totalParts).padStart(2, '0');
    const jobId = crypto.randomUUID();

    const parts: ZipPart[] = partsFiles.map((pFiles, idx) => {
      const partIndex = idx + 1;
      const filename = totalParts === 1
        ? `${baseName}.zip`
        : `${baseName}_Part_${String(partIndex).padStart(2, '0')}_of_${totalPadded}.zip`;
      const filePath = path.join(TEMP_ZIP_DIR, `${jobId}_part${partIndex}.zip`);

      return {
        partIndex,
        filename,
        filePath,
        totalFiles: pFiles.length,
        processedFiles: 0,
        sizeBytes: 0,
        status: 'pending'
      };
    });

    const job: ZipJob = {
      id: jobId,
      folderPath,
      baseFilename: baseName,
      partSize,
      totalParts,
      currentPartIndex: 1,
      parts,
      status: 'zipping',
      progress: 0,
      processedFiles: 0,
      totalFiles: existingFiles.length,
      totalBytes: 0,
      createdAt: Date.now(),
      shareToken,
      watermark,
      contentFingerprint: currentFingerprint
    };

    zipJobs.set(jobId, job);

    // Asynchronous background packaging of all parts sequentially
    (async () => {
      for (let pIdx = 0; pIdx < parts.length; pIdx++) {
        const part = parts[pIdx];
        job.currentPartIndex = pIdx + 1;
        part.status = 'zipping';

        await new Promise<void>((resolve, reject) => {
          const output = fs.createWriteStream(part.filePath);
          const archive = new ZipArchive({
            zlib: { level: 0 },
            forceZip64: maxBytesPerPart >= 4 * 1024 * 1024 * 1024
          });

          archive.pipe(output);

          archive.on('error', (err: any) => {
            console.error(`[ZIP] Archiver error on part ${part.partIndex}:`, err);
            reject(err);
          });

          output.on('error', (err: any) => {
            console.error(`[ZIP] Write error on part ${part.partIndex}:`, err);
            reject(err);
          });

          output.on('finish', () => {
            try {
              if (fs.existsSync(part.filePath)) {
                const stat = fs.statSync(part.filePath);
                part.sizeBytes = stat.size;
                part.status = 'ready';
                resolve();
              } else {
                reject(new Error(`Temporary zip part ${part.filePath} not found on finish.`));
              }
            } catch (e) {
              reject(e);
            }
          });

          (async () => {
            const fileList = partsFiles[pIdx];
            for (let i = 0; i < fileList.length; i++) {
              const file = fileList[i];
              const relativeName = file.folderPath === folderPath
                ? file.fileName
                : path.relative(folderPath, path.join(file.folderPath, file.fileName));

              let sourcePath = file.fullPath;
              let destName = relativeName;

              if (effectiveTemplate && !effectiveTemplate.allow_hd_download && file.mimeType?.startsWith('image/')) {
                const tier = effectiveTemplate.restricted_tier || '1080p';
                const cacheTierDir = path.resolve(CACHE_ROOT, tier === '500px' ? '480p' : '1080p');
                const tierPath = path.resolve(cacheTierDir, `${file.id}.webp`);
                if (fs.existsSync(tierPath)) {
                  sourcePath = tierPath;
                  const ext = file.fileName.match(/\.[^/.]+$/)?.[0] || '.jpg';
                  destName = `${relativeName.replace(/\.[^/.]+$/, '')}_${tier}${ext}`;
                }
              }

              if (shouldWatermark && file.mimeType?.startsWith('image/')) {
                try {
                  const isJpg = destName.match(/\.jpe?g$/i);
                  const format = isJpg ? 'jpeg' : 'webp';
                  const buffer = await WatermarkService.addWatermarkToStream(sourcePath, effectiveTemplate, file, format);
                  archive.append(buffer, { name: destName });
                } catch (e) {
                  console.error('[ZIP] Failed to watermark in zip:', e);
                  archive.file(sourcePath, { name: destName });
                }
              } else {
                archive.file(sourcePath, { name: destName });
              }

              part.processedFiles++;
              job.processedFiles++;
              job.progress = Math.round((job.processedFiles / job.totalFiles) * 100);
            }

            await archive.finalize();
          })().catch(reject);
        });
      }

      job.status = 'ready';
      job.progress = 100;
      job.totalBytes = job.parts.reduce((sum, p) => sum + p.sizeBytes, 0);
      scheduleJobDeletion(jobId, 15 * 60 * 1000);
    })().catch(err => {
      console.error('[ZIP] Background zip error:', err);
      job.status = 'error';
      job.error = err.message || 'Failed to archive files';
    });

    return reply.send({
      jobId,
      totalFiles: existingFiles.length,
      totalParts: job.totalParts,
      partSize: job.partSize
    });
  });

  // 2. Status polling endpoint
  fastify.get<{ Params: { jobId: string }, Querystring: { shareToken?: string } }>('/api/zip/status/:jobId', async (request, reply) => {
    const { jobId } = request.params;
    const job = zipJobs.get(jobId);

    if (!job) {
      return reply.status(404).send({ error: 'ZIP job not found or expired.' });
    }

    if (!(await verifyFolderAccess(request, reply, job.folderPath))) return;

    return reply.send({
      status: job.status,
      progress: job.progress,
      processedFiles: job.processedFiles,
      totalFiles: job.totalFiles,
      totalBytes: job.totalBytes,
      totalParts: job.totalParts,
      currentPartIndex: job.currentPartIndex,
      partSize: job.partSize,
      parts: job.parts.map(p => ({
        partIndex: p.partIndex,
        filename: p.filename,
        sizeBytes: p.sizeBytes,
        totalFiles: p.totalFiles,
        status: p.status
      })),
      error: job.error
    });
  });

  // Helper for serving a specific zip part
  async function serveZipPart(request: FastifyRequest, reply: FastifyReply, jobId: string, partIndexParam?: string) {
    const job = zipJobs.get(jobId);

    if (!job) {
      return reply.status(404).send({ error: 'ZIP job not found or expired.' });
    }

    if (!(await verifyFolderAccess(request, reply, job.folderPath))) return;

    const targetPartIndex = partIndexParam ? parseInt(partIndexParam, 10) : 1;
    const targetPart = job.parts.find(p => p.partIndex === targetPartIndex);

    if (!targetPart || !fs.existsSync(targetPart.filePath)) {
      return reply.status(404).send({ error: `ZIP part ${targetPartIndex} not found or expired.` });
    }

    AnalyticsService.logVisit({
      actionType: 'download_folder',
      folderPath: job.folderPath,
      shareToken: (request.query as any)?.shareToken || job.shareToken,
      ip: request.ip,
      userAgent: request.headers['user-agent'] as string | undefined,
      referrer: request.headers.referer as string | undefined,
      path: request.url
    });

    const isAuth = (request as any).user != null;
    const stat = fs.statSync(targetPart.filePath);
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(targetPart.filename)}"`);
    reply.header('Content-Length', stat.size);

    const ip = request.ip || 'unknown';
    const limits = await getThrottleLimits();
    const globalLimit = isAuth ? limits.authGlobalLimit : limits.publicGlobalLimit;

    const fileStream = fs.createReadStream(targetPart.filePath);

    // Reset deletion timer to 5 minutes after download completes
    reply.raw.on('finish', () => {
      console.log(`[ZIP] Download completed for job ${job.id} (part ${targetPart.partIndex}). Deletion timer reset to 5 minutes.`);
      scheduleJobDeletion(job.id, 5 * 60 * 1000);
    });

    if (globalLimit > 0 || (isAuth ? limits.authLimit : limits.publicLimit) > 0) {
      return reply.send(fileStream.pipe(new BandwidthThrottler(ip, isAuth)));
    } else {
      return reply.send(fileStream);
    }
  }

  // 3. Download endpoints (serves pre-zipped parts with full Content-Length and resets 5-minute cleanup)
  fastify.get<{ Params: { jobId: string }, Querystring: { shareToken?: string, part?: string } }>('/api/zip/download/:jobId', async (request, reply) => {
    return serveZipPart(request, reply, request.params.jobId, (request.query as any)?.part);
  });

  fastify.get<{ Params: { jobId: string; partIndex: string }, Querystring: { shareToken?: string } }>('/api/zip/download/:jobId/:partIndex', async (request, reply) => {
    return serveZipPart(request, reply, request.params.jobId, request.params.partIndex);
  });

  // 4. Fallback direct stream endpoint
  fastify.get<{ Params: { '*': string }, Querystring: { shareToken?: string, watermark?: string } }>('/api/zip/*', async (request, reply) => {
    const folderPath = decodeURIComponent(request.params['*'] || '');
    const { watermark, shareToken } = request.query;
    
    if (!(await verifyFolderAccess(request, reply, folderPath))) return;

    AnalyticsService.logVisit({
      actionType: 'download_folder',
      folderPath,
      shareToken,
      ip: request.ip,
      userAgent: request.headers['user-agent'] as string | undefined,
      referrer: request.headers.referer as string | undefined,
      path: request.url
    });
    
    const effectiveTemplate = await WatermarkService.getEffectiveTemplateForShare(shareToken);
    const shouldWatermark = watermark === 'true' || Boolean(effectiveTemplate?.apply_to_downloads);

    const result = folderPath === ''
      ? await query(
          `SELECT id, folder_path, file_name, mime_type, size_bytes, created_at,
                  exif_json->>'DateTimeOriginal' as captured_at,
                  exif_json->>'Make' as camera_make,
                  exif_json->>'Model' as camera_model,
                  exif_json->>'LensModel' as lens_model,
                  exif_json->>'ISO' as iso,
                  exif_json->>'ExposureTime' as shutter_speed,
                  exif_json->>'FNumber' as f_number,
                  exif_json->>'Copyright' as copyright
           FROM media_files ORDER BY folder_path ASC, file_name ASC`
        )
      : await query(
          `SELECT id, folder_path, file_name, mime_type, size_bytes, created_at,
                  exif_json->>'DateTimeOriginal' as captured_at,
                  exif_json->>'Make' as camera_make,
                  exif_json->>'Model' as camera_model,
                  exif_json->>'LensModel' as lens_model,
                  exif_json->>'ISO' as iso,
                  exif_json->>'ExposureTime' as shutter_speed,
                  exif_json->>'FNumber' as f_number,
                  exif_json->>'Copyright' as copyright
           FROM media_files WHERE folder_path = $1 OR folder_path LIKE $1 || '/%' ORDER BY folder_path ASC, file_name ASC`, 
          [folderPath]
        );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'No files found in this folder.' });
    }

    const existingFiles: Array<any> = [];
    for (const file of result.rows) {
      const fullPath = path.join(MEDIA_ROOT, file.folder_path, file.file_name);
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        existingFiles.push({
          ...file,
          fullPath,
          fileName: file.file_name,
          folderPath: file.folder_path,
          mimeType: file.mime_type,
          sizeBytes: stat.size
        });
      }
    }

    if (existingFiles.length === 0) {
      return reply.status(404).send({ error: 'No files found on disk for this folder.' });
    }

    const archive = new ZipArchive({
      zlib: { level: 0 }
    });

    const zipFilename = folderPath ? folderPath.split('/').pop() : 'Home_Photos';
    
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(zipFilename || 'Photos')}.zip"`);

    if (!shouldWatermark) {
      let totalZipSize = 22;
      for (const file of existingFiles) {
        const relativeName = file.folderPath === folderPath
          ? file.fileName
          : path.relative(folderPath, path.join(file.folderPath, file.fileName));
        const nameBytes = Buffer.byteLength(relativeName, 'utf8');
        totalZipSize += (30 + nameBytes) + file.sizeBytes + 16 + (46 + nameBytes);
      }
      if (totalZipSize < 0xFFFFFFFF && existingFiles.length < 65535) {
        reply.header('Content-Length', totalZipSize);
      }
    }

    const isAuth = (request as any).user != null;
    const ip = request.ip || 'unknown';
    const limits = await getThrottleLimits();
    const globalLimit = isAuth ? limits.authGlobalLimit : limits.publicGlobalLimit;
    
    if (globalLimit > 0 || (isAuth ? limits.authLimit : limits.publicLimit) > 0) {
      reply.send(archive.pipe(new BandwidthThrottler(ip, isAuth)));
    } else {
      reply.send(archive);
    }

    archive.on('error', (err: any) => {
      console.error('[ZIP] Archiver error:', err);
    });

    for (const file of existingFiles) {
      const relativeName = file.folderPath === folderPath
        ? file.fileName
        : path.relative(folderPath, path.join(file.folderPath, file.fileName));

      let sourcePath = file.fullPath;
      let destName = relativeName;

      if (effectiveTemplate) {
        if (!effectiveTemplate.allow_hd_download && file.mimeType?.startsWith('image/')) {
          const tier = effectiveTemplate.restricted_tier || '1080p';
          const cacheTierDir = path.resolve(CACHE_ROOT, tier === '500px' ? '480p' : '1080p');
          const tierPath = path.resolve(cacheTierDir, `${file.id}.webp`);
          if (fs.existsSync(tierPath)) {
            sourcePath = tierPath;
            destName = `${relativeName.replace(/\.[^/.]+$/, '')}_${tier}.webp`;
          }
        }
      }

      if (shouldWatermark && file.mimeType?.startsWith('image/')) {
        try {
          const buffer = await WatermarkService.addWatermarkToStream(sourcePath, effectiveTemplate, file);
          archive.append(buffer, { name: destName });
        } catch (e) {
          console.error('[ZIP] Failed to watermark in zip:', e);
          archive.file(sourcePath, { name: destName });
        }
      } else {
        archive.file(sourcePath, { name: destName });
      }
    }

    await archive.finalize();
  });
}
