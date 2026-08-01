import { Queue } from 'bullmq';
import IORedis from 'ioredis';
const connection = new IORedis({ host: 'localhost', port: 8003 });
const q = new Queue('scanner', { connection });
async function run() {
  console.log("Is paused?", await q.isPaused());
  const waiting = await q.getWaiting();
  console.log("Waiting jobs:", waiting.map(j => ({id: j.id, name: j.name, data: j.data})));
  const active = await q.getActive();
  console.log("Active jobs:", active.map(j => ({id: j.id, name: j.name, data: j.data})));
  process.exit(0);
}
run();
