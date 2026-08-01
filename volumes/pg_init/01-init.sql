-- Enable Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS ltree;

-- Files & Folder Index
CREATE TABLE media_files (
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
);

CREATE INDEX idx_media_folder ON media_files(folder_path);
CREATE INDEX IF NOT EXISTS idx_media_files_clip_embedding ON media_files USING hnsw (clip_embedding vector_cosine_ops);

-- Facial Embeddings
CREATE TABLE face_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id UUID REFERENCES media_files(id) ON DELETE CASCADE,
    person_id UUID,
    bounding_box JSONB NOT NULL, -- {x, y, w, h}
    embedding vector(512) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Public Shares
CREATE TABLE shared_folders (
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
);

-- Analytics Engine
CREATE TABLE media_analytics (
    id BIGSERIAL PRIMARY KEY,
    media_id UUID REFERENCES media_files(id) ON DELETE CASCADE,
    share_token VARCHAR(32),
    action_type VARCHAR(30) NOT NULL, -- 'VIEW_1080P', 'VIEW_480P', 'DOWNLOAD_RAW'
    bytes_served BIGINT NOT NULL,
    ip_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Per-visit Analytics (device/OS/browser/IP breakdowns)
CREATE TABLE IF NOT EXISTS analytics_visits (
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
);
CREATE INDEX IF NOT EXISTS idx_analytics_visits_created ON analytics_visits(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_visits_share ON analytics_visits(share_token);
CREATE INDEX IF NOT EXISTS idx_analytics_visits_ip_hash ON analytics_visits(ip_hash);
CREATE INDEX IF NOT EXISTS idx_analytics_visits_action ON analytics_visits(action_type);

-- Folder Settings (Custom Covers)
CREATE TABLE folder_settings (
    folder_path TEXT PRIMARY KEY,
    description TEXT,
    cover_media_id UUID REFERENCES media_files(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Smart Search Embeddings
CREATE TABLE IF NOT EXISTS smart_search_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id UUID REFERENCES media_files(id) ON DELETE CASCADE,
    embedding vector(512) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(media_id)
);

