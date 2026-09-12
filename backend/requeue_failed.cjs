const { Queue } = require('bullmq');
const Redis = require('ioredis');

const redis = new Redis({ host: '127.0.0.1', port: 8003 });

async function requeue() {
  const q = new Queue('thumbnail', { connection: redis });
  const failed = await q.getFailed();
  
  if (failed.length === 0) {
    console.log('No failed jobs found in thumbnail queue.');
  } else {
    for (const job of failed) {
      console.log(`Re-queueing job ${job.id}...`);
      await job.retry();
    }
  }

  await q.close();
  process.exit(0);
}

requeue();
