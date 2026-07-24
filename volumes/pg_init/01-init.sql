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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(folder_path, file_name)
);

CREATE INDEX idx_media_folder ON media_files(folder_path);

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
    folder_path TEXT NOT NULL,
    share_token VARCHAR(32) UNIQUE NOT NULL,
    allow_download BOOLEAN DEFAULT false,
    watermark_enabled BOOLEAN DEFAULT false,
    strip_gps_on_download BOOLEAN DEFAULT true,
    expires_at TIMESTAMP WITH TIME ZONE,
    password_hash TEXT,
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
