import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

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
