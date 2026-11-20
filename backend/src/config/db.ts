import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'hellomyphotos',
  password: process.env.DB_PASS || 'hellomyphotos_secret',
  database: process.env.DB_NAME || 'hellomyphotos',
  max: parseInt(process.env.DB_POOL_MAX || '25', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Prevent unhandled error events from crashing the process when idle connections drop or Postgres restarts
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err.message);
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
  `DO $$ BEGIN
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user', 'viewer', 'super_admin'));
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='token_version') THEN ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1; END IF; END $$;`,
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
    failed_attempts INTEGER DEFAULT 0,
    processing_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(folder_path, file_name)
  )`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_folder ON media_files(folder_path)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_files_clip_embedding ON media_files USING hnsw (clip_embedding vector_cosine_ops)`,

  // M-7 Fix: text_pattern_ops index enables efficient LIKE 'prefix%' queries on folder_path.
  // Without this, every folder browse cover-image lookup degrades to a full sequential scan.
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_files_folder_path_tpo ON media_files (folder_path text_pattern_ops)`,

  `CREATE TABLE IF NOT EXISTS face_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id UUID REFERENCES media_files(id) ON DELETE CASCADE,
    person_id UUID,
    bounding_box JSONB,
    embedding vector(512),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_face_embeddings_person ON face_embeddings(person_id)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_face_embeddings_person_id_covering_partial ON face_embeddings (person_id) INCLUDE (media_id, bounding_box, created_at) WHERE person_id IS NOT NULL`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_face_embeddings_person_id_created_at ON face_embeddings(person_id, created_at) WHERE person_id IS NOT NULL`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_face_embeddings_media ON face_embeddings(media_id)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_face_embeddings_embedding ON face_embeddings USING hnsw (embedding vector_cosine_ops)`,

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
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
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
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shared_folders' AND column_name='person_id') THEN ALTER TABLE shared_folders ADD COLUMN person_id UUID REFERENCES people(id) ON DELETE SET NULL; END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shared_folders' AND column_name='is_active') THEN ALTER TABLE shared_folders ADD COLUMN is_active BOOLEAN DEFAULT true; END IF; END $$;`,
  `DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shared_folders_created_by_fkey' AND confdeltype = 'c') THEN
      ALTER TABLE shared_folders DROP CONSTRAINT shared_folders_created_by_fkey;
      ALTER TABLE shared_folders ADD CONSTRAINT shared_folders_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
  END $$;`,
  `INSERT INTO people (id, name) SELECT DISTINCT person_id, '' FROM face_embeddings WHERE person_id IS NOT NULL ON CONFLICT (id) DO NOTHING`,

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
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media_files' AND column_name='has_1080p') THEN ALTER TABLE media_files ADD COLUMN has_1080p BOOLEAN DEFAULT false; END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media_files' AND column_name='has_480p') THEN ALTER TABLE media_files ADD COLUMN has_480p BOOLEAN DEFAULT false; END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media_files' AND column_name='is_transcoded') THEN ALTER TABLE media_files ADD COLUMN is_transcoded BOOLEAN DEFAULT false; END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media_files' AND column_name='transcoded_mp4_path') THEN ALTER TABLE media_files ADD COLUMN transcoded_mp4_path TEXT; END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media_files' AND column_name='transcoded_webm_path') THEN ALTER TABLE media_files ADD COLUMN transcoded_webm_path TEXT; END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media_files' AND column_name='clip_embedding') THEN ALTER TABLE media_files ADD COLUMN clip_embedding vector(512); END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media_files' AND column_name='file_identifier') THEN ALTER TABLE media_files ADD COLUMN file_identifier VARCHAR(255); END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='media_files_file_identifier_key') THEN ALTER TABLE media_files ADD CONSTRAINT media_files_file_identifier_key UNIQUE (file_identifier); END IF; END $$;`,
  `DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='media_files_folder_path_file_name_key') THEN ALTER TABLE media_files DROP CONSTRAINT media_files_folder_path_file_name_key; END IF; END $$;`,

  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media_files' AND column_name='img_width') THEN ALTER TABLE media_files ADD COLUMN img_width INTEGER; END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media_files' AND column_name='img_height') THEN ALTER TABLE media_files ADD COLUMN img_height INTEGER; END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media_files' AND column_name='processing_error') THEN ALTER TABLE media_files ADD COLUMN processing_error TEXT; END IF; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media_files' AND column_name='failed_attempts') THEN ALTER TABLE media_files ADD COLUMN failed_attempts INTEGER DEFAULT 0; END IF; END $$;`,

  `CREATE TABLE IF NOT EXISTS folder_settings (
    folder_path TEXT PRIMARY KEY,
    cover_media_id UUID REFERENCES media_files(id) ON DELETE SET NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='folder_settings' AND column_name='auto_cover_media_id') THEN ALTER TABLE folder_settings ADD COLUMN auto_cover_media_id UUID REFERENCES media_files(id) ON DELETE SET NULL; END IF; END $$;`,


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
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_visits_created ON analytics_visits(created_at)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_visits_share ON analytics_visits(share_token)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_visits_ip_hash ON analytics_visits(ip_hash)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_visits_action ON analytics_visits(action_type)`,

  `CREATE TABLE IF NOT EXISTS share_access_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_token VARCHAR(32),
    folder_path TEXT,
    name VARCHAR(255),
    email VARCHAR(255),
    note TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_share_access_requests_token ON share_access_requests(share_token)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_share_access_requests_folder ON share_access_requests(folder_path)`,

  `ALTER TABLE analytics_visits ADD COLUMN IF NOT EXISTS page_load_ms INTEGER`,
  `ALTER TABLE analytics_visits ADD COLUMN IF NOT EXISTS session_duration_s INTEGER`,
  `ALTER TABLE analytics_visits ADD COLUMN IF NOT EXISTS photo_view_ms INTEGER`,
  `ALTER TABLE analytics_visits ADD COLUMN IF NOT EXISTS sort_mode VARCHAR(30)`,
  `ALTER TABLE analytics_visits ADD COLUMN IF NOT EXISTS view_mode VARCHAR(30)`,
  `ALTER TABLE analytics_visits ADD COLUMN IF NOT EXISTS features_used TEXT[]`,
  `ALTER TABLE analytics_visits ADD COLUMN IF NOT EXISTS download_time_ms INTEGER`,
  `ALTER TABLE analytics_visits ADD COLUMN IF NOT EXISTS network_type VARCHAR(30)`,
  `ALTER TABLE analytics_visits ADD COLUMN IF NOT EXISTS screen_res VARCHAR(30)`,
  `ALTER TABLE analytics_visits ADD COLUMN IF NOT EXISTS scroll_depth_pct INTEGER`,
  `ALTER TABLE analytics_visits ADD COLUMN IF NOT EXISTS folders_visited TEXT[]`,
  `ALTER TABLE analytics_visits ADD COLUMN IF NOT EXISTS metadata JSONB`,
  `ALTER TABLE analytics_visits ADD COLUMN IF NOT EXISTS device_id VARCHAR(64)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_visits_device_id ON analytics_visits(device_id)`,
  `ALTER TABLE analytics_visits ADD COLUMN IF NOT EXISTS cache_bytes_saved BIGINT`,
  `ALTER TABLE analytics_visits ADD COLUMN IF NOT EXISTS cache_hits INTEGER`,
  `ALTER TABLE analytics_visits ADD COLUMN IF NOT EXISTS cache_misses INTEGER`,

  // ---- Watermark Templates & Share Links ----
  `CREATE TABLE IF NOT EXISTS watermark_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_default BOOLEAN DEFAULT false,
    type VARCHAR(20) NOT NULL DEFAULT 'text',
    text_content TEXT DEFAULT '© {year} {copyright}',
    font_family VARCHAR(100) DEFAULT 'Inter',
    font_weight VARCHAR(20) DEFAULT 'bold',
    font_style VARCHAR(20) DEFAULT 'normal',
    font_color VARCHAR(32) DEFAULT '#ffffff',
    text_align VARCHAR(20) DEFAULT 'center',
    letter_spacing NUMERIC(5,2) DEFAULT 0.0,
    line_spacing NUMERIC(4,2) DEFAULT 1.2,
    image_path TEXT,
    shadow_enabled BOOLEAN DEFAULT true,
    shadow_color VARCHAR(32) DEFAULT '#000000',
    shadow_opacity NUMERIC(3,2) DEFAULT 0.75,
    shadow_radius NUMERIC(5,2) DEFAULT 4.0,
    shadow_offset_x NUMERIC(5,2) DEFAULT 2.0,
    shadow_offset_y NUMERIC(5,2) DEFAULT 2.0,
    bg_box_enabled BOOLEAN DEFAULT false,
    bg_box_color VARCHAR(32) DEFAULT '#000000',
    bg_box_opacity NUMERIC(3,2) DEFAULT 0.5,
    bg_box_padding_x NUMERIC(5,2) DEFAULT 12.0,
    bg_box_padding_y NUMERIC(5,2) DEFAULT 8.0,
    bg_box_border_radius NUMERIC(5,2) DEFAULT 6.0,
    anchor VARCHAR(20) DEFAULT 'bottom-right',
    inset_x NUMERIC(5,2) DEFAULT 3.0,
    inset_y NUMERIC(5,2) DEFAULT 3.0,
    scale_mode VARCHAR(30) DEFAULT 'proportional_long_edge',
    scale_value NUMERIC(5,2) DEFAULT 15.0,
    rotation NUMERIC(5,2) DEFAULT 0.0,
    opacity NUMERIC(3,2) DEFAULT 0.85,
    is_tiled BOOLEAN DEFAULT false,
    allow_hd_download BOOLEAN DEFAULT false,
    restricted_tier VARCHAR(20) DEFAULT '1080p',
    apply_to_previews BOOLEAN DEFAULT true,
    apply_to_downloads BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shared_folders' AND column_name='watermark_template_id') THEN ALTER TABLE shared_folders ADD COLUMN watermark_template_id UUID REFERENCES watermark_templates(id) ON DELETE SET NULL; END IF; END $$;`,
  `INSERT INTO watermark_templates (id, name, description, is_default, type, text_content, font_family, anchor, inset_x, inset_y, scale_mode, scale_value, opacity, allow_hd_download, restricted_tier)
   SELECT '00000000-0000-0000-0000-000000000001', 'Default Studio Copyright', 'Standard bottom-right copyright badge with 1080p web downloads', true, 'text', '© {year} {copyright}', 'Inter', 'bottom-right', 3.0, 3.0, 'proportional_long_edge', 15.0, 0.85, false, '1080p'
   WHERE NOT EXISTS (SELECT 1 FROM watermark_templates)`,

  // ---- Performance Optimization: Fast People Clusters & Indexes ----
  `ALTER TABLE people ADD COLUMN IF NOT EXISTS cover_face_id UUID REFERENCES face_embeddings(id) ON DELETE SET NULL`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_face_embeddings_person_media ON face_embeddings(person_id, media_id)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_people_cover_media ON people(cover_media_id)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_people_cover_face ON people(cover_face_id)`,
  `ALTER TABLE people ADD COLUMN IF NOT EXISTS face_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE people ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_people_face_count ON people(face_count DESC, updated_at DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_people_name ON people(name, face_count DESC)`,
  `INSERT INTO people (id, name, face_count, cover_face_id, cover_media_id, updated_at)
   SELECT 
     agg.person_id,
     '',
     agg.cnt,
     rep.id,
     rep.media_id,
     agg.latest
   FROM (
     SELECT person_id, COUNT(*)::int as cnt, MAX(created_at) as latest
     FROM face_embeddings
     WHERE person_id IS NOT NULL
     GROUP BY person_id
   ) agg
   CROSS JOIN LATERAL (
     SELECT id, media_id
     FROM face_embeddings
     WHERE person_id = agg.person_id
     ORDER BY created_at DESC
     LIMIT 1
   ) rep
   ON CONFLICT (id) DO UPDATE SET
     face_count = EXCLUDED.face_count,
     cover_face_id = COALESCE(people.cover_face_id, EXCLUDED.cover_face_id),
     cover_media_id = COALESCE(people.cover_media_id, EXCLUDED.cover_media_id),
     updated_at = EXCLUDED.updated_at`,

  // ---- Performance Optimization: Media & Analytics Indexes ----
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_files_created ON media_files(created_at DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_files_folder_created ON media_files(folder_path, created_at DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_files_exif_gin ON media_files USING gin (exif_json)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_analytics_media_id ON media_analytics(media_id)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_analytics_share_token ON media_analytics(share_token)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_analytics_created ON media_analytics(created_at)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shared_folders_token ON shared_folders(share_token)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shared_folders_active_expires ON shared_folders(is_active, expires_at)`,
];

// Statements not yet successfully applied. Succeeded ones are dropped so they
// aren't re-run; failing ones (e.g. CREATE EXTENSION vector on a DB where the
// app role lacks privileges) are retried on the next ensureSchema call instead
// of aborting the whole bootstrap.
let pendingStatements: string[] | null = SCHEMA_STATEMENTS;
let lastSchemaCheck = 0;
const RETRY_COOLDOWN_MS = 30_000;

export const ensureSchema = async (): Promise<void> => {
  if (pendingStatements === null) return;
  // Throttle retries if statements are pending to avoid flooding logs and DB queries on every request
  const now = Date.now();
  if (now - lastSchemaCheck < RETRY_COOLDOWN_MS && lastSchemaCheck !== 0) return;

  if (!schemaPromise) {
    schemaPromise = (async () => {
      lastSchemaCheck = Date.now();
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
