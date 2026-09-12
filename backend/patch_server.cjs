const fs = require('fs');
const file = 'backend/src/server.ts';
let content = fs.readFileSync(file, 'utf8');

// Undo the previous patch
content = content.replace(
  'global.killWorker = () => {\n        console.log("Received killWorker signal! Terminating worker process to abort jobs...");\n        if (workerProc) {\n          workerProc.kill("SIGKILL");\n        }\n      };\n\n      const spawnWorker = () => {',
  'const spawnWorker = () => {'
);

// We need to add redis pubsub subscription in the worker orchestrator
const pubSubCode = `
      // Listen for kill signals from the API
      import { redis } from './config/redis';
      const sub = redis.duplicate();
      sub.subscribe('worker:control');
      sub.on('message', (channel, message) => {
        if (channel === 'worker:control' && message === 'kill') {
          console.log('Received remote kill signal via Redis! Terminating worker process to abort jobs...');
          if (workerProc) {
            workerProc.kill('SIGKILL');
          }
        }
      });
      
      const spawnWorker = () => {`;

content = content.replace('const spawnWorker = () => {', pubSubCode);

fs.writeFileSync(file, content);
console.log('Patched server.ts for Redis PubSub');
