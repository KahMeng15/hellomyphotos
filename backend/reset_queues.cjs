const { Queue } = require('bullmq');
const Redis = require('ioredis');

const redis = new Redis({ host: '127.0.0.1', port: 8003 });

async function reset() {
  console.log('Clearing batch lock...');
  await redis.del('queue:batch:running');

  const queues = [
    'scanner', 'metadata', 'thumbnail', 'video',
    'smart-search', 'face-detection', 'facial-recognition', 'face-thumbnail'
  ];

  for (const name of queues) {
    console.log(`Clearing queue: ${name}...`);
    const q = new Queue(name, { connection: redis });
    await q.obliterate({ force: true }).catch(e => console.log(`  - obliterate failed: ${e.message}`));
    await q.drain().catch(e => console.log(`  - drain failed: ${e.message}`));
    await q.close();
  }

  console.log('All queues reset and batch lock cleared.');
  process.exit(0);
}

reset();
