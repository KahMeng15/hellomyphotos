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
    
    const result = await query(
      `SELECT folder_path, file_name, mime_type FROM media_files WHERE folder_path = $1 ORDER BY file_name ASC`, 
      [folderPath]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'No files found in this folder.' });
    }

    const archive = new ZipArchive({
      zlib: { level: 0 } // Level 0 (Store) since JPEGs and MP4s are already highly compressed. Much faster!
    });

    const zipFilename = folderPath ? folderPath.split('/').pop() : 'Home_Photos';
    
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(zipFilename || 'Photos')}.zip"`);
    

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

    const wSettings = await WatermarkService.getSettings();
    const shouldWatermark = watermark === 'true' || wSettings.enforceGlobal;

    for (const file of result.rows) {
      const fullPath = path.join(MEDIA_ROOT, file.folder_path, file.file_name);
      if (fs.existsSync(fullPath)) {
        if (shouldWatermark && file.mime_type?.startsWith('image/')) {
          try {
            const buffer = await WatermarkService.addWatermarkToStream(fullPath);
            archive.append(buffer, { name: file.file_name });
          } catch (e) {
            console.error('Failed to watermark in zip:', e);
            archive.file(fullPath, { name: file.file_name });
          }
        } else {
          archive.file(fullPath, { name: file.file_name });
        }
      }
    }

    await archive.finalize();
  });
}
