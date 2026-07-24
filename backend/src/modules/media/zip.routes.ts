import { FastifyInstance } from 'fastify';
import { ZipArchive } from 'archiver';
import { query } from '../../config/db';
import path from 'path';
import fs from 'fs';

const MEDIA_ROOT = process.env.MEDIA_ROOT || '/app/media';

export async function zipRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { '*': string } }>('/api/zip/*', async (request, reply) => {
    const folderPath = decodeURIComponent(request.params['*'] || '');
    
    const result = await query(
      `SELECT folder_path, file_name FROM media_files WHERE folder_path = $1 ORDER BY file_name ASC`, 
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
    
    // Pipe the archive stream directly to the fastify reply
    reply.send(archive);
    
    archive.on('error', (err: any) => {
      console.error('Archiver error:', err);
    });

    for (const file of result.rows) {
      const fullPath = path.join(MEDIA_ROOT, file.folder_path, file.file_name);
      if (fs.existsSync(fullPath)) {
        archive.file(fullPath, { name: file.file_name });
      }
    }

    await archive.finalize();
  });
}
