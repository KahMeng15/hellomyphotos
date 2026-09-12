const fs = require('fs');
const file = 'backend/src/modules/admin/queue.routes.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  '(global as any).killWorker?.();',
  'await redis.publish(\'worker:control\', \'kill\');'
);

fs.writeFileSync(file, content);
console.log('Patched queue.routes.ts for Redis PubSub');
