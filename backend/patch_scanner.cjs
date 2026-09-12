const fs = require('fs');
const file = 'backend/src/modules/scanner/scanner.routes.ts';
let content = fs.readFileSync(file, 'utf8');

// Replace regenerate-images
content = content.replace(
  /const result = await query\([\s\S]*?`,\s*\[folder,\s*`\$\{folder\}\/%`\]\);[\s\S]*?for\s*\(const row of result.rows\) \{[\s\S]*?await thumbnailQueue\.add\([\s\S]*?\}\s*return reply\.send\(\{ success: true, count: result\.rows\.length \}\);/m,
  `let result;
    if (!folder || folder === '') {
      result = await query(\`
        UPDATE media_files 
        SET has_480p = false, has_1080p = false 
        WHERE mime_type LIKE 'image/%'
        RETURNING id, folder_path, file_name, mime_type
      \`);
    } else {
      result = await query(\`
        UPDATE media_files 
        SET has_480p = false, has_1080p = false 
        WHERE (folder_path = $1 OR folder_path LIKE $2) 
        AND mime_type LIKE 'image/%'
        RETURNING id, folder_path, file_name, mime_type
      \`, [folder, \`\${folder}/%\`]);
    }

    const CACHE_ROOT = process.env.CACHE_ROOT || '/app/cache';
    for (const row of result.rows) {
      try {
        const p480 = path.join(CACHE_ROOT, '480p', \`\${row.id}.webp\`);
        const p1080 = path.join(CACHE_ROOT, '1080p', \`\${row.id}.webp\`);
        if (fs.existsSync(p480)) fs.unlinkSync(p480);
        if (fs.existsSync(p1080)) fs.unlinkSync(p1080);
      } catch (e) {
        console.warn('Failed to delete cache files', e);
      }

      const fullPath = path.join(MEDIA_ROOT, row.folder_path, row.file_name);
      await thumbnailQueue.add('generate-thumbnail', { mediaId: row.id, fullPath, mimeType: row.mime_type }, { priority: 2 }).catch(() => {});
    }

    return reply.send({ success: true, count: result.rows.length });`
);

// Replace regenerate-videos
content = content.replace(
  /const result = await query\([\s\S]*?`,\s*\[folder,\s*`\$\{folder\}\/%`\]\);[\s\S]*?for\s*\(const row of result.rows\) \{[\s\S]*?await videoQueue\.add\([\s\S]*?\}\s*return reply\.send\(\{ success: true, count: result\.rows\.length \}\);/m,
  `let result;
    if (!folder || folder === '') {
      result = await query(\`
        UPDATE media_files 
        SET has_480p = false, has_1080p = false, is_transcoded = false
        WHERE mime_type LIKE 'video/%'
        RETURNING id, folder_path, file_name, mime_type
      \`);
    } else {
      result = await query(\`
        UPDATE media_files 
        SET has_480p = false, has_1080p = false, is_transcoded = false
        WHERE (folder_path = $1 OR folder_path LIKE $2) 
        AND mime_type LIKE 'video/%'
        RETURNING id, folder_path, file_name, mime_type
      \`, [folder, \`\${folder}/%\`]);
    }

    const CACHE_ROOT = process.env.CACHE_ROOT || '/app/cache';
    for (const row of result.rows) {
      try {
        const p480 = path.join(CACHE_ROOT, '480p', \`\${row.id}.webp\`);
        const pMp4 = path.join(CACHE_ROOT, 'transcoded', 'mp4', \`\${row.id}.mp4\`);
        const pWebm = path.join(CACHE_ROOT, 'transcoded', 'webm', \`\${row.id}.webm\`);
        if (fs.existsSync(p480)) fs.unlinkSync(p480);
        if (fs.existsSync(pMp4)) fs.unlinkSync(pMp4);
        if (fs.existsSync(pWebm)) fs.unlinkSync(pWebm);
      } catch (e) {
        console.warn('Failed to delete cache files', e);
      }

      const fullPath = path.join(MEDIA_ROOT, row.folder_path, row.file_name);
      await videoQueue.add('process-video', { mediaId: row.id, fullPath, mimeType: row.mime_type, skipCascade: true }, { priority: 2 }).catch(() => {});
    }

    return reply.send({ success: true, count: result.rows.length });`
);

fs.writeFileSync(file, content);
