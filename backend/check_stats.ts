import { queues, getExecutionMode } from './src/queue';
async function run() {
  console.log("Mode:", await getExecutionMode());
  for (const [name, q] of Object.entries(queues)) {
    const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed');
    console.log(name, counts);
  }
  process.exit(0);
}
run();
