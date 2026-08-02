import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'hellomyphotos',
  password: process.env.DB_PASS || 'hellomyphotos_secret',
  database: process.env.DB_NAME || 'hellomyphotos',
});

let schemaPromise: Promise<void> | null = null;

// DDL statements run one-by-one (NOT in a single transaction). Each statement is
// idempotent (IF NOT EXISTS), so a failure mid-way leaves the earlier statements
// applied and the rest are retried on the next call instead of being rolled back.
const SCHEMA_STATEMENTS = [
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS has_1080p BOOLEAN DEFAULT false`,
  `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS has_480p BOOLEAN DEFAULT false`,
  `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS is_transcoded BOOLEAN DEFAULT false`,
  `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS transcoded_mp4_path TEXT`,
  `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS transcoded_webm_path TEXT`,
  `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS clip_embedding vector(512)`,
  `CREATE INDEX IF NOT EXISTS idx_media_files_clip_embedding ON media_files USING hnsw (clip_embedding vector_cosine_ops)`,

  // M-7 Fix: text_pattern_ops index enables efficient LIKE 'prefix%' queries on folder_path.
  // Without this, every folder browse cover-image lookup degrades to a full sequential scan.
  `CREATE INDEX IF NOT EXISTS idx_media_files_folder_path_tpo ON media_files (folder_path text_pattern_ops)`,

  `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS img_width INTEGER`,
  `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS img_height INTEGER`,

  `CREATE TABLE IF NOT EXISTS face_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id UUID REFERENCES media_files(id) ON DELETE CASCADE,
    person_id UUID,
    bounding_box JSONB,
    embedding vector(512),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_face_embeddings_person ON face_embeddings(person_id)`,
  `CREATE INDEX IF NOT EXISTS idx_face_embeddings_embedding ON face_embeddings USING hnsw (embedding vector_cosine_ops)`,

  `CREATE TABLE IF NOT EXISTS people (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    cover_media_id UUID REFERENCES media_files(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `ALTER TABLE people ADD COLUMN IF NOT EXISTS cover_media_id UUID REFERENCES media_files(id) ON DELETE SET NULL`,
  `ALTER TABLE shared_folders ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES people(id) ON DELETE SET NULL`,
  `ALTER TABLE shared_folders ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`,

  `CREATE TABLE IF NOT EXISTS system_logs (
    id SERIAL PRIMARY KEY,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ip_address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS folder_settings (
    folder_path TEXT PRIMARY KEY,
    cover_media_id UUID REFERENCES media_files(id) ON DELETE SET NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `ALTER TABLE folder_settings ADD COLUMN IF NOT EXISTS auto_cover_media_id UUID REFERENCES media_files(id) ON DELETE SET NULL`,

  `CREATE TABLE IF NOT EXISTS analytics_visits (
    id BIGSERIAL PRIMARY KEY,
    media_id UUID REFERENCES media_files(id) ON DELETE CASCADE,
    share_token VARCHAR(32),
    action_type VARCHAR(30) NOT NULL,
    ip VARCHAR(45),
    ip_hash VARCHAR(64) NOT NULL,
    user_agent TEXT,
    os VARCHAR(60),
    browser VARCHAR(60),
    device_type VARCHAR(20),
    referrer TEXT,
    path TEXT,
    folder_path TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `ALTER TABLE analytics_visits ADD COLUMN IF NOT EXISTS folder_path TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_analytics_visits_created ON analytics_visits(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_analytics_visits_share ON analytics_visits(share_token)`,
  `CREATE INDEX IF NOT EXISTS idx_analytics_visits_ip_hash ON analytics_visits(ip_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_analytics_visits_action ON analytics_visits(action_type)`,
];

export const ensureSchema = async (): Promise<void> => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      try {
        for (const statement of SCHEMA_STATEMENTS) {
          await pool.query(statement);
        }
      } catch (err: any) {
        // Reset so the next ensureSchema call retries the remaining statements.
        // The failing statement (or a preceding race with an unready DB) should
        // not permanently poison the schema bootstrap.
        schemaPromise = null;
        console.warn('[DB] ensureSchema notice:', err.message);
      }
    })();
  }
  return schemaPromise;
};

export const query = async (text: string, params?: any[]) => {
  await ensureSchema();
  return pool.query(text, params);
};
