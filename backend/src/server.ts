import { app } from './app';
import { logger } from './utils/logger';
// Ensure worker is imported so it starts processing
import './queue';
// Ensure cron starts
import './cron/periodicScanner';
import './cron/analyticsCron';

logger.info('Server starting up');

import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);

import { getContainerCpuCount } from './config/cpu';

const start = async () => {
  try {
    if (process.env.IS_WORKER === 'true') {
      console.log('Background worker process initialized.');
      // Keep worker process alive
      process.on('SIGTERM', () => process.exit(0));
    } else {
      if (process.env.DISABLE_API !== 'true') {
        await app.listen({ port: PORT, host: '0.0.0.0' });
        app.log.info(`Server listening on port ${PORT}`);
        logger.info(`Server started on port ${PORT}`);
      } else {
        logger.info(`API disabled via DISABLE_API=true. Running worker orchestrator only.`);
      }
      
      const maxCpuCores = String(getContainerCpuCount());

      let workerProc: ReturnType<typeof fork> | null = null;
      let isShuttingDown = false;

      const spawnWorker = () => {
        if (isShuttingDown || process.env.DISABLE_WORKER === 'true') {
          if (process.env.DISABLE_WORKER === 'true') {
            console.log('Worker disabled via DISABLE_WORKER=true');
          }
          return;
        }
        console.log(`Forking background worker process with concurrency ${maxCpuCores}...`);
        workerProc = fork(__filename, [], {
          env: { 
            ...process.env, 
            IS_WORKER: 'true',
            SCANNER_CONCURRENCY: '1', // Always 1 for IO safety
            METADATA_CONCURRENCY: maxCpuCores,
            THUMBNAIL_CONCURRENCY: maxCpuCores,
            VIDEO_CONCURRENCY: maxCpuCores,
            SMART_SEARCH_CONCURRENCY: maxCpuCores,
            FACE_DETECTION_CONCURRENCY: maxCpuCores,
            FACIAL_RECOGNITION_CONCURRENCY: '1', // Clustering must always be 1
            FACE_THUMBNAIL_CONCURRENCY: maxCpuCores
          },
          execArgv: process.execArgv // preserve tsx loader in dev
        });

        workerProc.on('exit', (code, signal) => {
          if (isShuttingDown) return;
          console.warn(`Worker process exited with code ${code}, signal ${signal}. Respawning in 3 seconds...`);
          setTimeout(spawnWorker, 3000);
        });
      };

      spawnWorker();
      
      // Ensure worker is killed when main process exits
      process.on('exit', () => { isShuttingDown = true; workerProc?.kill(); });
      process.on('SIGINT', () => { isShuttingDown = true; workerProc?.kill(); process.exit(0); });
      process.on('SIGTERM', () => { isShuttingDown = true; workerProc?.kill(); process.exit(0); });
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
