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

export const ensureSchema = async (): Promise<void> => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      try {
        await pool.query(`
          CREATE EXTENSION IF NOT EXISTS vector;
          ALTER TABLE media_files ADD COLUMN IF NOT EXISTS has_1080p BOOLEAN DEFAULT false;
          ALTER TABLE media_files ADD COLUMN IF NOT EXISTS has_480p BOOLEAN DEFAULT false;
          ALTER TABLE media_files ADD COLUMN IF NOT EXISTS is_transcoded BOOLEAN DEFAULT false;
          ALTER TABLE media_files ADD COLUMN IF NOT EXISTS transcoded_mp4_path TEXT;
          ALTER TABLE media_files ADD COLUMN IF NOT EXISTS transcoded_webm_path TEXT;
          ALTER TABLE media_files ADD COLUMN IF NOT EXISTS clip_embedding vector(512);
          CREATE INDEX IF NOT EXISTS idx_media_files_clip_embedding ON media_files USING hnsw (clip_embedding vector_cosine_ops);

          -- M-7 Fix: text_pattern_ops index enables efficient LIKE 'prefix%' queries on folder_path.
          -- Without this, every folder browse cover-image lookup degrades to a full sequential scan.
          CREATE INDEX IF NOT EXISTS idx_media_files_folder_path_tpo ON media_files (folder_path text_pattern_ops);

          ALTER TABLE media_files ADD COLUMN IF NOT EXISTS img_width INTEGER;
          ALTER TABLE media_files ADD COLUMN IF NOT EXISTS img_height INTEGER;

          CREATE TABLE IF NOT EXISTS face_embeddings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            media_id UUID REFERENCES media_files(id) ON DELETE CASCADE,
            person_id UUID,
            bounding_box JSONB,
            embedding vector(512),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_face_embeddings_person ON face_embeddings(person_id);
          CREATE INDEX IF NOT EXISTS idx_face_embeddings_embedding ON face_embeddings USING hnsw (embedding vector_cosine_ops);

          CREATE TABLE IF NOT EXISTS people (
            id UUID PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            cover_media_id UUID REFERENCES media_files(id) ON DELETE SET NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
          ALTER TABLE people ADD COLUMN IF NOT EXISTS cover_media_id UUID REFERENCES media_files(id) ON DELETE SET NULL;
          ALTER TABLE shared_folders ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES people(id) ON DELETE SET NULL;
          ALTER TABLE shared_folders ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

          CREATE TABLE IF NOT EXISTS system_logs (
            id SERIAL PRIMARY KEY,
            level TEXT NOT NULL DEFAULT 'info',
            message TEXT NOT NULL,
            user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            ip_address TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
        `);
      } catch (err: any) {
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
