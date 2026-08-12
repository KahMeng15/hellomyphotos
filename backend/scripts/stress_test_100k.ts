import { query } from '../src/config/db';
import { randomUUID } from 'crypto';

/**
 * STRESS TEST: 100k Dummy Jobs
 * 
 * This script injects 100,000 fake records into your database.
 * Because the actual files won't exist on disk, the workers will immediately fail 
 * the jobs when you trigger processing. 
 * 
 * This is incredibly useful because it tests the absolute worst-case scenario for the backend:
 * 1. Queueing 100k jobs at once (tests `streamEnqueue` stability).
 * 2. Workers burning through jobs instantly (tests `drainWait` polling stability without the 134 crash).
 * 3. Frontend API polling against a massive queue state.
 */

async function seed100k() {
  console.log('Starting 100k Database Seeding...');
  const TOTAL = 100000;
  const BATCH_SIZE = 5000;
  
  // Create a dummy folder to easily isolate and delete these later
  const mockFolder = '/stress_test_mock_folder';

  try {
    console.log('Clearing any existing mock data from previous runs...');
    await query(`DELETE FROM media_files WHERE folder_path = $1`, [mockFolder]);
    console.log('Cleared! Now injecting 100k new records...');

    for (let i = 0; i < TOTAL; i += BATCH_SIZE) {
      const values: string[] = [];
      for (let j = 0; j < BATCH_SIZE; j++) {
        // We leave exif_json as NULL so they get picked up by the Metadata queue
        values.push(`('${randomUUID()}', '${mockFolder}', 'mock_file_${i+j}.jpg', 'image/jpeg', 1000)`);
      }
      
      const sql = `INSERT INTO media_files (id, folder_path, file_name, mime_type, size_bytes) VALUES ${values.join(', ')}`;
      await query(sql);
      
      console.log(`Inserted ${i + BATCH_SIZE} / ${TOTAL} records...`);
    }

    console.log('\n✅ Seeding Complete!');
    console.log('----------------------------------------------------');
    console.log('NEXT STEPS:');
    console.log('1. Go to your Admin Queues page.');
    console.log('2. Make sure you are in "Batch Mode".');
    console.log('3. Click "Start All".');
    console.log('4. Watch the backend effortlessly handle streaming 100k jobs to Redis.');
    console.log('5. Watch the workers rapidly fail 100k jobs (since the files don\'t exist).');
    console.log('6. Verify that the backend NO LONGER crashes with Exit Code 134!');
    console.log('\nTo clean up after the test, run:');
    console.log(`DELETE FROM media_files WHERE folder_path = '${mockFolder}';`);
    console.log('And then click "Clear Failed" on the Queues page.');

  } catch (err) {
    console.error('Error during seeding:', err);
  }
}

seed100k().then(() => process.exit(0));
