import { query } from './config/db';
import { videoQueue } from './queue/videoQueue';
import path from 'path';

(async () => {
  console.log('Triggering video transcodes...');
  const mediaRoot = process.env.MEDIA_ROOT || path.resolve(process.cwd(), '../volumes/media_ro');
  const res = await query("SELECT id, folder_path, file_name, mime_type FROM media_files WHERE mime_type LIKE 'video/%' AND is_transcoded = false");
  for (const row of res.rows) {
    const fullPath = path.resolve(mediaRoot, row.folder_path, row.file_name);
    await videoQueue.add('generate-video-proxy', {
      mediaId: row.id,
      fullPath,
      mimeType: row.mime_type,
      skipCascade: true
    });
  }
  console.log(`Queued ${res.rows.length} videos.`);
  process.exit(0);
})();
