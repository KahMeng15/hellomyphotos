import { query } from '../src/config/db';
import { queues } from '../src/queue';
import { redis } from '../src/config/redis';

async function cleanup() {
  console.log('Starting Cleanup...');
  
  const mockFolder = '/stress_test_mock_folder';

  try {
    // 1. Delete from Database
    console.log('Deleting mock records from the database...');
    const result = await query(`DELETE FROM media_files WHERE folder_path = $1`, [mockFolder]);
    console.log(`✅ Deleted ${result.rowCount} records from the database.`);

    // 2. Clear all Failed jobs from queues
    console.log('Clearing failed jobs from all queues...');
    for (const [name, q] of Object.entries(queues)) {
      await q.clean(0, 200000, 'failed');
      console.log(`   - Cleared ${name}`);
    }
    
    // Clear the UI cache so it updates immediately
    await redis.del('queue:stats:cache');

    console.log('\n✅ Cleanup Complete! Your database and queues are back to normal.');

  } catch (err) {
    console.error('Error during cleanup:', err);
  } finally {
    // BullMQ requires explicit disconnection
    await redis.quit();
    process.exit(0);
  }
}

cleanup();
