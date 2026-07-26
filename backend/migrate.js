const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'hellomyphotos',
  password: 'hellomyphotos_secret',
  database: 'hellomyphotos'
});

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) DEFAULT 'Unknown',
        password_hash TEXT NOT NULL,
        role VARCHAR(50) NOT NULL CHECK (role IN ('super_admin', 'admin', 'user', 'viewer')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_folder_access (
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        folder_path TEXT NOT NULL,
        PRIMARY KEY (user_id, folder_path)
    );

    CREATE TABLE IF NOT EXISTS system_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        level VARCHAR(20) NOT NULL,
        message TEXT NOT NULL,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        ip_address VARCHAR(45),
        meta JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admin_settings (
        key VARCHAR(255) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS media_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        folder_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type VARCHAR(50) NOT NULL,
        size_bytes BIGINT NOT NULL,
        blurhash TEXT,
        exif_json JSONB,
        has_1080p BOOLEAN DEFAULT false,
        has_480p BOOLEAN DEFAULT false,
        is_transcoded BOOLEAN DEFAULT false,
        transcoded_mp4_path TEXT,
        transcoded_webm_path TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(folder_path, file_name)
    );

    CREATE EXTENSION IF NOT EXISTS vector;

    ALTER TABLE media_files ADD COLUMN IF NOT EXISTS has_1080p BOOLEAN DEFAULT false;
    ALTER TABLE media_files ADD COLUMN IF NOT EXISTS has_480p BOOLEAN DEFAULT false;
    ALTER TABLE media_files ADD COLUMN IF NOT EXISTS is_transcoded BOOLEAN DEFAULT false;
    ALTER TABLE media_files ADD COLUMN IF NOT EXISTS transcoded_mp4_path TEXT;
    ALTER TABLE media_files ADD COLUMN IF NOT EXISTS transcoded_webm_path TEXT;
    ALTER TABLE media_files ADD COLUMN IF NOT EXISTS clip_embedding vector(512);
    CREATE INDEX IF NOT EXISTS idx_media_files_clip_embedding ON media_files USING hnsw (clip_embedding vector_cosine_ops);
  `);
  console.log("Migration successful");
  process.exit(0);
}
run();
