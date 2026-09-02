import { FastifyInstance } from 'fastify';
import { ZipArchive } from 'archiver';
import { query } from '../../config/db';
import path from 'path';
import fs from 'fs';
import { verifyFolderAccess } from '../../utils/auth';
import { WatermarkService } from './watermark.service';
import { AnalyticsService } from '../analytics/analytics.service';

const MEDIA_ROOT = process.env.MEDIA_ROOT || '/app/media';

import { getThrottleLimits, BandwidthThrottler } from '../../utils/throttle';

export async function zipRoutes(fastify: FastifyInstance) {
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

    const result = await query(
      `SELECT folder_path, file_name, mime_type, size_bytes FROM media_files WHERE folder_path = $1 ORDER BY file_name ASC`, 
      [folderPath]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'No files found in this folder.' });
    }

    // Filter to existing files on disk
    const existingFiles: Array<{ fullPath: string; fileName: string; mimeType: string; sizeBytes: number }> = [];
    for (const file of result.rows) {
      const fullPath = path.join(MEDIA_ROOT, file.folder_path, file.file_name);
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        existingFiles.push({
          fullPath,
          fileName: file.file_name,
          mimeType: file.mime_type,
          sizeBytes: stat.size
        });
      }
    }

    if (existingFiles.length === 0) {
      return reply.status(404).send({ error: 'No files found on disk for this folder.' });
    }

    const archive = new ZipArchive({
      zlib: { level: 0 } // Level 0 (Store) since JPEGs and MP4s are already highly compressed. Much faster!
    });

    const zipFilename = folderPath ? folderPath.split('/').pop() : 'Home_Photos';
    
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(zipFilename || 'Photos')}.zip"`);

    // If we are not applying on-the-fly watermark buffers, we know the exact size of the zip upfront!
    // Format: Store level 0 with file stream uses Data Descriptor:
    // Per entry: 30 (local header) + nameBytes + file.sizeBytes + 16 (data descriptor) + 46 (central dir header) + nameBytes
    // End of central directory record: 22 bytes
    if (!shouldWatermark) {
      let totalZipSize = 22;
      for (const file of existingFiles) {
        const nameBytes = Buffer.byteLength(file.fileName, 'utf8');
        totalZipSize += (30 + nameBytes) + file.sizeBytes + 16 + (46 + nameBytes);
      }
      reply.header('Content-Length', totalZipSize);
    }

    const isAuth = (request as any).user != null;
    const ip = request.ip || 'unknown';
    const limits = await getThrottleLimits();
    const globalLimit = isAuth ? limits.authGlobalLimit : limits.publicGlobalLimit;
    
    // Pipe the archive stream directly to the fastify reply, optionally through the throttler
    if (globalLimit > 0 || (isAuth ? limits.authLimit : limits.publicLimit) > 0) {
      reply.send(archive.pipe(new BandwidthThrottler(ip, isAuth)));
    } else {
      reply.send(archive);
    }

    archive.on('error', (err: any) => {
      console.error('Archiver error:', err);
    });

    for (const file of existingFiles) {
      if (shouldWatermark && file.mimeType?.startsWith('image/')) {
        try {
          const buffer = await WatermarkService.addWatermarkToStream(file.fullPath);
          archive.append(buffer, { name: file.fileName });
        } catch (e) {
          console.error('Failed to watermark in zip:', e);
          archive.file(file.fullPath, { name: file.fileName });
        }
      } else {
        archive.file(file.fullPath, { name: file.fileName });
      }
    }

    await archive.finalize();
  });
}
