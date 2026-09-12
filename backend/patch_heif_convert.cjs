const fs = require('fs');
const file = 'backend/src/modules/media/media.service.ts';
let content = fs.readFileSync(file, 'utf8');

const targetStr = `      const runFfmpegFallback = async () => {
        console.warn(\`[MediaService] Sharp failed on HEIC, falling back to ffmpeg for \${fullPath}\`);
        await new Promise<void>((resolve, reject) => {
          ffmpeg(fullPath)
            .outputOptions(['-vframes 1', '-q:v 2'])
            .save(tmpPngPath)
            .on('end', () => resolve())
            .on('error', (e) => reject(e));
        });
        cleanupTmp = true;
        return tmpPngPath as string | Buffer;
      };`;

const replaceStr = `      const runHeifConvertFallback = async () => {
        console.warn(\`[MediaService] Sharp failed on HEIC, falling back to heif-convert for \${fullPath}\`);
        const { execFile } = require('child_process');
        await new Promise<void>((resolve, reject) => {
          execFile('heif-convert', [fullPath, tmpPngPath], (error) => {
            if (error) {
              reject(new Error(\`heif-convert failed: \${error.message}\`));
            } else {
              resolve();
            }
          });
        });
        cleanupTmp = true;
        return tmpPngPath as string | Buffer;
      };`;

content = content.replace(targetStr, replaceStr);

// Also need to rename the call site
content = content.replace('sharpInput = await runFfmpegFallback();', 'sharpInput = await runHeifConvertFallback();');

fs.writeFileSync(file, content);
