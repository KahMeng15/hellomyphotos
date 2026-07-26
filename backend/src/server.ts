import { app } from './app';
// Ensure worker is imported so it starts processing
import './queue';
// Ensure cron starts
import './cron/periodicScanner';
import './cron/analyticsCron';

import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);

const start = async () => {
  try {
    if (process.env.IS_WORKER === 'true') {
      console.log('Background worker process initialized.');
      // Keep worker process alive
      process.on('SIGTERM', () => process.exit(0));
    } else {
      await app.listen({ port: PORT, host: '0.0.0.0' });
      app.log.info(`Server listening on port ${PORT}`);
      
      console.log('Forking background worker process...');
      const workerProc = fork(__filename, [], {
        env: { ...process.env, IS_WORKER: 'true' },
        execArgv: process.execArgv // preserve tsx loader in dev
      });

      workerProc.on('exit', (code) => {
        console.warn(`Worker process exited with code ${code}`);
      });
      
      // Ensure worker is killed when main process exits
      process.on('exit', () => workerProc.kill());
      process.on('SIGINT', () => { workerProc.kill(); process.exit(0); });
      process.on('SIGTERM', () => { workerProc.kill(); process.exit(0); });
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
