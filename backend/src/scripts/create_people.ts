import { query } from '../config/db';

async function run() {
  await query(`
    CREATE TABLE IF NOT EXISTS people (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  console.log('People table created!');
  process.exit(0);
}

run().catch(console.error);
