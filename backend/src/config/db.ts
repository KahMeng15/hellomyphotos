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
//
// This list mirrors volumes/pg_init/*.sql so the app can bootstrap a fresh database
// entirely from the DB_* env vars — including an external DB that never ran the
// docker-entrypoint-initdb.d scripts. Statements are ordered so that referenced
// tables/extensions are created before the statements that depend on them.
const SCHEMA_STATEMENTS = [
  // ---- Extensions (01-init.sql) ----
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `CREATE EXTENSION IF NOT EXISTS ltree`,

  // ---- Auth / users (00-auth.sql + 99-e2e-role.sql) ----
  `CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    password_hash TEXT NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'user', 'viewer', 'super_admin')),
    preferences JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`,
  `ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user', 'viewer', 'super_admin'))`,
  `CREATE TABLE IF NOT EXISTS user_folder_access (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    folder_path TEXT NOT NULL,
    PRIMARY KEY (user_id, folder_path)
  )`,

  // ---- Media (01-init.sql) ----
  `CREATE TABLE IF NOT EXISTS media_files (
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
    clip_embedding vector(512),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(folder_path, file_name)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_media_folder ON media_files(folder_path)`,
  `CREATE INDEX IF NOT EXISTS idx_media_files_clip_embedding ON media_files USING hnsw (clip_embedding vector_cosine_ops)`,

  // M-7 Fix: text_pattern_ops index enables efficient LIKE 'prefix%' queries on folder_path.
  // Without this, every folder browse cover-image lookup degrades to a full sequential scan.
  `CREATE INDEX IF NOT EXISTS idx_media_files_folder_path_tpo ON media_files (folder_path text_pattern_ops)`,

  `CREATE TABLE IF NOT EXISTS face_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id UUID REFERENCES media_files(id) ON DELETE CASCADE,
    person_id UUID,
    bounding_box JSONB,
    embedding vector(512),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_face_embeddings_person ON face_embeddings(person_id)`,
  `CREATE INDEX IF NOT EXISTS idx_face_embeddings_media ON face_embeddings(media_id)`,
  `CREATE INDEX IF NOT EXISTS idx_face_embeddings_embedding ON face_embeddings USING hnsw (embedding vector_cosine_ops)`,

  `CREATE TABLE IF NOT EXISTS shared_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_path TEXT,
    media_id UUID REFERENCES media_files(id) ON DELETE CASCADE,
    person_id UUID,
    share_token VARCHAR(32) UNIQUE NOT NULL,
    allow_download BOOLEAN DEFAULT false,
    allow_download_images BOOLEAN DEFAULT false,
    allow_download_folder BOOLEAN DEFAULT false,
    watermark_enabled BOOLEAN DEFAULT false,
    strip_gps_on_download BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP WITH TIME ZONE,
    password_hash TEXT,
    created_by UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS media_analytics (
    id BIGSERIAL PRIMARY KEY,
    media_id UUID REFERENCES media_files(id) ON DELETE CASCADE,
    share_token VARCHAR(32),
    action_type VARCHAR(30) NOT NULL,
    bytes_served BIGINT NOT NULL,
    ip_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS smart_search_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id UUID REFERENCES media_files(id) ON DELETE CASCADE,
    embedding vector(512) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(media_id)
  )`,

  `CREATE TABLE IF NOT EXISTS people (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    cover_media_id UUID REFERENCES media_files(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `ALTER TABLE shared_folders ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES people(id) ON DELETE SET NULL`,
  `ALTER TABLE shared_folders ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`,

  // ---- Settings / logs (03-settings-logs.sql) ----
  `CREATE TABLE IF NOT EXISTS system_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ip_address VARCHAR(45),
    meta JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS admin_settings (
    key VARCHAR(255) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,

  // ---- Default admin user (00-auth.sql) ----
  `INSERT INTO users (email, name, password_hash, role)
   VALUES ('admin@example.com', 'Admin', '$2b$10$6RA2zF7AVoZaXO/Wj126ROvtJnVNecG4dvJRW9Sinw1HHUV1SlWYa', 'admin')
   ON CONFLICT (email) DO NOTHING`,

  // ---- media_files column upgrades (older DBs) ----
  `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS has_1080p BOOLEAN DEFAULT false`,
  `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS has_480p BOOLEAN DEFAULT false`,
  `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS is_transcoded BOOLEAN DEFAULT false`,
  `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS transcoded_mp4_path TEXT`,
  `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS transcoded_webm_path TEXT`,
  `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS clip_embedding vector(512)`,

  `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS img_width INTEGER`,
  `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS img_height INTEGER`,

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
  `CREATE INDEX IF NOT EXISTS idx_analytics_visits_created ON analytics_visits(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_analytics_visits_share ON analytics_visits(share_token)`,
  `CREATE INDEX IF NOT EXISTS idx_analytics_visits_ip_hash ON analytics_visits(ip_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_analytics_visits_action ON analytics_visits(action_type)`,
];

// Statements not yet successfully applied. Succeeded ones are dropped so they
// aren't re-run; failing ones (e.g. CREATE EXTENSION vector on a DB where the
// app role lacks privileges) are retried on the next ensureSchema call instead
// of aborting the whole bootstrap.
let pendingStatements: string[] | null = SCHEMA_STATEMENTS;

export const ensureSchema = async (): Promise<void> => {
  if (pendingStatements === null) return;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const stillPending: string[] = [];
      for (const statement of pendingStatements) {
        try {
          await pool.query(statement);
        } catch (err: any) {
          stillPending.push(statement);
          console.warn('[DB] ensureSchema notice:', err.message);
        }
      }
      pendingStatements = stillPending.length > 0 ? stillPending : null;
      schemaPromise = null;
      try {
        const status = await getDbStatus();
        console.log(`[DB] ensureSchema finished. ${pendingStatements ? 'PENDING ' + pendingStatements.length + ' statement(s); ' : ''}public tables (${status.tables.length}): ${status.tables.join(', ')}`);
      } catch (err: any) {
        console.warn('[DB] ensureSchema could not list tables:', err.message);
      }
    })();
  }
  return schemaPromise;
};

export const getDbStatus = async (): Promise<{ tables: string[]; pending: number }> => {
  const res = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  return {
    tables: res.rows.map((r) => r.tablename as string),
    pending: pendingStatements?.length ?? 0,
  };
};

export const query = async (text: string, params?: any[]) => {
  await ensureSchema();
  return pool.query(text, params);
};
