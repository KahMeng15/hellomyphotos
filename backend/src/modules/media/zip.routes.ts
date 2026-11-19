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

interface ZipJob {
  id: string;
  folderPath: string;
  zipFilename: string;
  filePath: string;
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
      if (fs.existsSync(job.filePath)) {
        fs.unlinkSync(job.filePath);
      }
    } catch (err) {
      console.error(`[ZIP] Failed to delete temp zip ${job.filePath}:`, err);
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

export async function zipRoutes(fastify: FastifyInstance) {
  // 1. Prepare / Pre-zip endpoint
  fastify.post('/api/zip/prepare', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body as any) || {};
    const queryParams = (request.query as any) || {};
    const folderPath = decodeURIComponent(body.folderPath ?? queryParams.folderPath ?? '');
    const shareToken = body.shareToken || queryParams.shareToken;
    const watermark = body.watermark || queryParams.watermark;

    if (shareToken && !(request.query as any)?.shareToken) {
      (request.query as any).shareToken = shareToken;
    }

    if (!(await verifyFolderAccess(request, reply, folderPath))) return;

    const wSettings = await WatermarkService.getSettings();
    const shouldWatermark = watermark === 'true' || wSettings.enforceGlobal;

    const result = folderPath === ''
      ? await query(`SELECT folder_path, file_name, mime_type, size_bytes FROM media_files ORDER BY folder_path ASC, file_name ASC`)
      : await query(
          `SELECT folder_path, file_name, mime_type, size_bytes FROM media_files WHERE folder_path = $1 OR folder_path LIKE $1 || '/%' ORDER BY folder_path ASC, file_name ASC`, 
          [folderPath]
        );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'No files found in this folder.' });
    }

    const existingFiles: Array<{ fullPath: string; fileName: string; folderPath: string; mimeType: string; sizeBytes: number; mtimeMs: number }> = [];
    for (const file of result.rows) {
      const fullPath = path.join(MEDIA_ROOT, file.folder_path, file.file_name);
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        existingFiles.push({
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

    // Compute content fingerprint across all files in this folder & its subfolders
    // Checks file paths, byte sizes, and disk modification timestamps.
    const hash = crypto.createHash('md5');
    for (const file of existingFiles) {
      hash.update(`${file.folderPath}/${file.fileName}:${file.sizeBytes}:${file.mtimeMs}\n`);
    }
    const currentFingerprint = hash.digest('hex');

    // Smart check: Reuse existing temporary zip if content hasn't changed and reset deletion timer
    for (const [id, existingJob] of zipJobs.entries()) {
      if (existingJob.folderPath === folderPath && existingJob.watermark === watermark) {
        if (existingJob.contentFingerprint === currentFingerprint && fs.existsSync(existingJob.filePath)) {
          if (existingJob.status === 'ready') {
            console.log(`[ZIP] Reusing existing temp zip for "${folderPath}". Resetting 5-minute deletion timer.`);
            scheduleJobDeletion(id, 5 * 60 * 1000);
            return reply.send({ jobId: id, totalFiles: existingJob.totalFiles, reused: true });
          } else if (existingJob.status === 'zipping') {
            console.log(`[ZIP] Reusing in-progress zip job for "${folderPath}".`);
            return reply.send({ jobId: id, totalFiles: existingJob.totalFiles, reused: true });
          }
        } else {
          // Content has changed or file is missing; remove outdated job
          try {
            if (fs.existsSync(existingJob.filePath)) fs.unlinkSync(existingJob.filePath);
          } catch {}
          zipJobs.delete(id);
        }
      }
    }

    const jobId = crypto.randomUUID();
    const zipFilename = folderPath ? folderPath.split('/').pop() : 'Home_Photos';
    const tempFilePath = path.join(TEMP_ZIP_DIR, `${jobId}.zip`);

    const job: ZipJob = {
      id: jobId,
      folderPath,
      zipFilename: zipFilename || 'Photos',
      filePath: tempFilePath,
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

    // Asynchronous background pre-zipping
    (async () => {
      const output = fs.createWriteStream(tempFilePath);
      const archive = new ZipArchive({
        zlib: { level: 0 } // Store mode: ultra fast, no CPU waste on compressed media
      });

      archive.pipe(output);

      archive.on('error', (err: any) => {
        console.error('[ZIP] Archiver error:', err);
        job.status = 'error';
        job.error = err.message || 'Archiver error';
      });

      output.on('error', (err: any) => {
        console.error('[ZIP] Output write error:', err);
        job.status = 'error';
        job.error = err.message || 'Write error';
      });

      output.on('finish', () => {
        try {
          if (fs.existsSync(tempFilePath)) {
            const stat = fs.statSync(tempFilePath);
            job.totalBytes = stat.size;
            job.status = 'ready';
            job.progress = 100;
            // Failsafe: if user never initiates download, delete after 15 minutes
            scheduleJobDeletion(jobId, 15 * 60 * 1000);
          } else {
            job.status = 'error';
            job.error = 'Temporary zip file was not found on completion.';
          }
        } catch (e: any) {
          job.status = 'error';
          job.error = e.message;
        }
      });

      for (let i = 0; i < existingFiles.length; i++) {
        const file = existingFiles[i];
        const relativeName = file.folderPath === folderPath
          ? file.fileName
          : path.relative(folderPath, path.join(file.folderPath, file.fileName));

        if (shouldWatermark && file.mimeType?.startsWith('image/')) {
          try {
            const buffer = await WatermarkService.addWatermarkToStream(file.fullPath);
            archive.append(buffer, { name: relativeName });
          } catch (e) {
            console.error('[ZIP] Failed to watermark in zip:', e);
            archive.file(file.fullPath, { name: relativeName });
          }
        } else {
          archive.file(file.fullPath, { name: relativeName });
        }

        job.processedFiles = i + 1;
        job.progress = Math.round(((i + 1) / existingFiles.length) * 100);
      }

      await archive.finalize();
    })().catch(err => {
      console.error('[ZIP] Background zip error:', err);
      job.status = 'error';
      job.error = err.message || 'Failed to archive files';
    });

    return reply.send({
      jobId,
      totalFiles: existingFiles.length
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
      error: job.error
    });
  });

  // 3. Download endpoint (serves the pre-zipped file with full Content-Length and resets 5-minute cleanup)
  fastify.get<{ Params: { jobId: string }, Querystring: { shareToken?: string } }>('/api/zip/download/:jobId', async (request, reply) => {
    const { jobId } = request.params;
    const job = zipJobs.get(jobId);

    if (!job || !fs.existsSync(job.filePath)) {
      return reply.status(404).send({ error: 'ZIP file not found or expired.' });
    }

    if (!(await verifyFolderAccess(request, reply, job.folderPath))) return;

    AnalyticsService.logVisit({
      actionType: 'download_folder',
      folderPath: job.folderPath,
      shareToken: request.query.shareToken || job.shareToken,
      ip: request.ip,
      userAgent: request.headers['user-agent'] as string | undefined,
      referrer: request.headers.referer as string | undefined,
      path: request.url
    });

    const isAuth = (request as any).user != null;
    const stat = fs.statSync(job.filePath);
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(job.zipFilename || 'Photos')}.zip"`);
    reply.header('Content-Length', stat.size);

    const ip = request.ip || 'unknown';
    const limits = await getThrottleLimits();
    const globalLimit = isAuth ? limits.authGlobalLimit : limits.publicGlobalLimit;

    const fileStream = fs.createReadStream(job.filePath);

    // Reset deletion timer to 5 minutes after download completes
    reply.raw.on('finish', () => {
      console.log(`[ZIP] Download completed for job ${job.id}. Deletion timer reset to 5 minutes.`);
      scheduleJobDeletion(job.id, 5 * 60 * 1000);
    });

    if (globalLimit > 0 || (isAuth ? limits.authLimit : limits.publicLimit) > 0) {
      return reply.send(fileStream.pipe(new BandwidthThrottler(ip, isAuth)));
    } else {
      return reply.send(fileStream);
    }
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
    
    const wSettings = await WatermarkService.getSettings();
    const shouldWatermark = watermark === 'true' || wSettings.enforceGlobal;

    const result = folderPath === ''
      ? await query(`SELECT folder_path, file_name, mime_type, size_bytes FROM media_files ORDER BY folder_path ASC, file_name ASC`)
      : await query(
          `SELECT folder_path, file_name, mime_type, size_bytes FROM media_files WHERE folder_path = $1 OR folder_path LIKE $1 || '/%' ORDER BY folder_path ASC, file_name ASC`, 
          [folderPath]
        );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'No files found in this folder.' });
    }

    const existingFiles: Array<{ fullPath: string; fileName: string; folderPath: string; mimeType: string; sizeBytes: number }> = [];
    for (const file of result.rows) {
      const fullPath = path.join(MEDIA_ROOT, file.folder_path, file.file_name);
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        existingFiles.push({
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
      return reply.send(archive.pipe(new BandwidthThrottler(ip, isAuth)));
    } else {
      return reply.send(archive);
    }

    archive.on('error', (err: any) => {
      console.error('[ZIP] Archiver error:', err);
    });

    for (const file of existingFiles) {
      const relativeName = file.folderPath === folderPath
        ? file.fileName
        : path.relative(folderPath, path.join(file.folderPath, file.fileName));

      if (shouldWatermark && file.mimeType?.startsWith('image/')) {
        try {
          const buffer = await WatermarkService.addWatermarkToStream(file.fullPath);
          archive.append(buffer, { name: relativeName });
        } catch (e) {
          console.error('[ZIP] Failed to watermark in zip:', e);
          archive.file(file.fullPath, { name: relativeName });
        }
      } else {
        archive.file(file.fullPath, { name: relativeName });
      }
    }

    await archive.finalize();
  });
}
