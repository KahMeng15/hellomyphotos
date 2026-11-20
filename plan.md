# hellomyphotos Technical Product Requirement Document (PRD)

**Project Name:** Directory-First High-Performance Gallery Engine

**Tech Stack:** SvelteKit (Frontend) • Node.js / Fastify / TypeScript (Backend) • Redis • PostgreSQL + `pgvector` • Immich ML (AI Engine) • BullMQ (Worker Queues) • MaxMind GeoLite2 (GeoIP)

**Deployment:** Docker Containerized Environment (`docker-compose`)

---

## 1. System Overview & Core Goals

The goal of this project is to build a self-hosted, directory-first photo gallery that reads directly from existing disk folder hierarchies without moving or modifying files. It combines Google Photos-like UI speed, AI-driven facial recognition, semantic natural-language image search (CLIP), dynamic watermark generation with template styling, granular multi-entity sharing, expired share access request workflows, and comprehensive GeoIP visitor analytics—all engineered to operate smoothly under heavy concurrent traffic on constrained server resources.

---

## 2. Technical Stack Architecture

```text
                                  ┌───────────────────────────┐
                                  │      Client Browsers      │
                                  └─────────────┬─────────────┘
                                                │ (HTTP / SSE / WebSockets)
                 ┌──────────────────────────────┴──────────────────────────────┐
                 ▼                                                             ▼
┌─────────────────────────────────┐                           ┌─────────────────────────────────┐
│     SvelteKit Frontend App      │                           │   Node.js (Fastify) Backend     │
│   (SSR / Client Virtual Grid)   │                           │     (API, Auth, Stream, Proxy)  │
└─────────────────────────────────┘                           └────────────────┬────────────────┘
                                                                               │
                                ┌──────────────────────────────────────────────┼──────────────────────────────────────────────┐
                                ▼                                              ▼                                              ▼
                 ┌──────────────────────────────┐               ┌──────────────────────────────┐               ┌──────────────────────────────┐
                 │       Redis Container        │               │    PostgreSQL + pgvector     │               │   Immich ML Container        │
                 │ (Cache, Cooldowns, BullMQ)   │               │   (Metadata, Shares, Logs)   │               │  (Face Detection / Vectors)  │
                 └──────────────┬───────────────┘               └──────────────┬───────────────┘               └──────────────────────────────┘
                                │                                              │
                 ┌──────────────┴───────────────┐               ┌──────────────┴───────────────┐
                 │    Backend Worker Service    │               │      db-backup Container     │
                 │  (Thumbnails, FFmpeg, CLIP,  │               │ (Automated Daily PostgreSQL  │
                 │   Face Clustering, Avatars)  │               │     Dumps to ./volumes)      │
                 └──────────────────────────────┘               └──────────────────────────────┘
```

---

## 3. Detailed Functional Requirements

### 3.1. Directory Preservation & On-Demand Folder Scanning

* **Disk Integrity:** Read-only (`:ro`) volume mounting of host folders. Zero file modifications or moves on original disk paths.
* **On-Demand Scan Logic:**
  1. Trigger folder index when an end-user navigates to `/folder/*`.
  2. Query Redis for key: `scan_cooldown:<folder_path>`.
  3. **If Key Exists:** Serve directory tree directly from PostgreSQL cache.
  4. **If Key Missing:** Set `scan_cooldown:<folder_path>` in Redis with a 60-second TTL. Push a background job via BullMQ to run `fs.promises.readdir` on that specific path and insert/update missing file entries in PostgreSQL.
* **Worker Concurrency Tuning:** Sequential folder scanning (`SCANNER_CONCURRENCY=1`) to prevent DB lock contention while allowing parallel thumbnail and ML workers.
* **Periodic Background Scanning:** A scheduled cron job periodically scans the root directory to find new files dropped via FTP/SMB/rsync.
* **Symbolic Links:** The scanner detects and safely handles `fs.Dirent.isSymbolicLink()` to prevent infinite loops.
* **Garbage Collection:** Scans identify missing files and prune orphaned database rows, embeddings, and cached thumbnails.

### 3.2. Compression, Asset Pipeline & Low-Bandwidth Delivery

* **Pre-Processing Pipeline:** Background workers process newly indexed files using `sharp` (C++ bindings), native HEIC decoding, and `ffmpeg`:
  * **Blurhash / Micro-placeholder:** String representation saved directly into PostgreSQL for instant layout rendering.
  * **Thumbnail Cache Directory:** A dedicated read-write Docker volume for storing generated thumbnails and cached assets.
  * **Display Preview:** WebP format, max 1080p, quality 80 (~80–120 KB). Metadata headers (EXIF/GPS) explicitly stripped.
  * **Low-Res Mobile Preview:** WebP format, max 480p, quality 65 (~30 KB).
  * **Video Support & Transcoding:** Video files generate WebP thumbnails via `ffmpeg` and support direct streaming (HTTP range requests) with hardware acceleration (`LIBVA_DRIVER_NAME`).
  * **OpenGraph (OG) Previews:** Dynamic social share cards generated via Satori/Sharp.
* **Low-Bandwidth Mode:** Client settings toggle to force serving 480p low-res previews instead of 1080p previews across grid items and lightboxes.

### 3.3. Facial Recognition Pipeline

* **Integration:** Async HTTP POST calls to local `immich-machine-learning` microservice running at `http://machine-learning:3003/predict`.
* **Workflow:**
  1. Background worker sends WebP preview image to ML container (`model: "buffalo_l"` with SCRFD).
  2. Receive bounding box coordinates and 512-float face embedding arrays.
  3. Store face coordinates and vector embeddings inside PostgreSQL using `vector(512)` and generate cropped face avatar thumbnails.
  4. Run DBSCAN clustering queries in PostgreSQL via `pgvector` to group matching face vectors under unified Person records in `people`.
  5. Provide UI to rename, set cover photos, and merge duplicate people.

### 3.4. Smart Semantic Search (CLIP Embeddings)

* Dispatches preview images to Immich ML CLIP text-image models to extract 512-dimensional vector embeddings stored in `media_files.clip_embedding` and `smart_search_embeddings`.
* Indexed using PostgreSQL `pgvector` HNSW index (`USING hnsw (clip_embedding vector_cosine_ops)`).
* Allows natural-language queries (e.g. "beach party", "vintage car", "mountain landscape") from `/search`.

### 3.5. Dynamic Watermark Studio

* Fully customizable watermark templates stored in `watermark_templates`.
* Supports text or image logos, dynamic tokens (`{year}`, `{copyright}`), custom fonts, anchor positions, insets, scale mode, rotation, opacity, drop shadows, background box, and pattern tiling (`is_tiled`).
* Restricted download tiers (e.g. restrict shared downloads to watermarked 1080p while safeguarding raw originals).
* Watermarked previews and downloads cached under `volumes/cache_rw/watermarked/` and invalidated upon template updates.

### 3.6. Granular Sharing, Access Requests & Bulk Downloads

* Public links created in `shared_folders` supporting:
  * Whole folder shares (`folder_path`)
  * Individual media item shares (`media_id`)
  * Person album shares (`person_id`)
* Configurable settings: `expires_at`, `allow_download_images`, `allow_download_folder`, `watermark_enabled`, `strip_gps_on_download`, `password_hash`, `watermark_template_id`.
* **Expired Share Access Requests:** Visitors navigating to an expired or locked share can submit access requests (`share_access_requests`). Owners receive email notifications via SMTP.
* **Bulk ZIP Downloads:** Streaming ZIP generation for folders on-the-fly (`/api/media/download-zip`).

### 3.7. Usage Analytics & GeoIP Tracking

* Log image views (`PREVIEW_1080P`, `PREVIEW_480P`) and original file downloads asynchronously.
* **Write Buffer:** Buffer analytics counts in Redis memory using `HINCRBY analytics:views <file_id> 1` to eliminate write locks on PostgreSQL.
* **Per-Visit Tracking:** `analytics_visits` records device ID, user agent, browser, OS, MaxMind GeoLite2 country/city resolution, page load time, photo view duration, and cache hit/miss bandwidth savings.
* **Batch Worker:** A scheduled job flushes accumulated Redis analytics counts into PostgreSQL every 30 seconds.

---

## 4. Resource Control & Settings API

To prevent worker tasks from starving host system resources:

```text
                  ┌──────────────────────────────────────────────────┐
                  │          Admin Adjusts CPU Setting UI            │
                  └─────────────────────────┬────────────────────────┘
                                            │
                                            ▼
                  ┌──────────────────────────────────────────────────┐
                  │       `PUT /api/admin/settings/resources`        │
                  └─────────────────────────┬────────────────────────┘
                                            │
                                            ▼
                  ┌──────────────────────────────────────────────────┐
                  │       Write `settings:max_cpu_cores` &           │
                  │       `settings:scan_interval` to Redis          │
                  └─────────────────────────┬────────────────────────┘
                                            │
                 ┌──────────────────────────┴──────────────────────────┐
                 ▼                                                     ▼
┌──────────────────────────────────┐                 ┌──────────────────────────────────┐
│  BullMQ Queue Concurrency Limit  │                 │  FFmpeg Processing Spawn Command │
│  `worker.concurrency = maxCores` │                 │  `spawn('ffmpeg', ['-threads',   │
└──────────────────────────────────┘                 │   maxCores, ...])`               │
                                                     └──────────────────────────────────┘
```

---

## 5. Database Schema (PostgreSQL + `pgvector`)

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS ltree;

-- Users & Folder Access
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    password_hash TEXT NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'user', 'viewer', 'super_admin')),
    preferences JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_folder_access (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    folder_path TEXT NOT NULL,
    PRIMARY KEY (user_id, folder_path)
);

-- Media Files
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
    clip_embedding vector(512),
    file_identifier VARCHAR(255) UNIQUE,
    img_width INTEGER,
    img_height INTEGER,
    failed_attempts INTEGER DEFAULT 0,
    processing_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(folder_path, file_name)
);

CREATE INDEX IF NOT EXISTS idx_media_folder ON media_files(folder_path);
CREATE INDEX IF NOT EXISTS idx_media_files_folder_path_tpo ON media_files (folder_path text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_media_files_clip_embedding ON media_files USING hnsw (clip_embedding vector_cosine_ops);

-- People & Face Embeddings
CREATE TABLE IF NOT EXISTS people (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    cover_media_id UUID REFERENCES media_files(id) ON DELETE SET NULL,
    cover_face_id UUID,
    face_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS face_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id UUID REFERENCES media_files(id) ON DELETE CASCADE,
    person_id UUID REFERENCES people(id) ON DELETE SET NULL,
    bounding_box JSONB,
    embedding vector(512),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_face_embeddings_person ON face_embeddings(person_id);
CREATE INDEX IF NOT EXISTS idx_face_embeddings_media ON face_embeddings(media_id);
CREATE INDEX IF NOT EXISTS idx_face_embeddings_embedding ON face_embeddings USING hnsw (embedding vector_cosine_ops);

-- Watermark Templates
CREATE TABLE IF NOT EXISTS watermark_templates (
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
);

-- Public Shares & Access Requests
CREATE TABLE IF NOT EXISTS shared_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_path TEXT,
    media_id UUID REFERENCES media_files(id) ON DELETE CASCADE,
    person_id UUID REFERENCES people(id) ON DELETE SET NULL,
    watermark_template_id UUID REFERENCES watermark_templates(id) ON DELETE SET NULL,
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
);

CREATE TABLE IF NOT EXISTS share_access_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_token VARCHAR(32),
    folder_path TEXT,
    name VARCHAR(255),
    email VARCHAR(255),
    note TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Analytics & Visits
CREATE TABLE IF NOT EXISTS media_analytics (
    id BIGSERIAL PRIMARY KEY,
    media_id UUID REFERENCES media_files(id) ON DELETE CASCADE,
    share_token VARCHAR(32),
    action_type VARCHAR(30) NOT NULL,
    bytes_served BIGINT NOT NULL,
    ip_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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
    device_id VARCHAR(64),
    referrer TEXT,
    path TEXT,
    folder_path TEXT,
    page_load_ms INTEGER,
    session_duration_s INTEGER,
    photo_view_ms INTEGER,
    download_time_ms INTEGER,
    network_type VARCHAR(30),
    screen_res VARCHAR(30),
    scroll_depth_pct INTEGER,
    cache_bytes_saved BIGINT,
    cache_hits INTEGER,
    cache_misses INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Settings, Search & System Logs
CREATE TABLE IF NOT EXISTS folder_settings (
    folder_path TEXT PRIMARY KEY,
    cover_media_id UUID REFERENCES media_files(id) ON DELETE SET NULL,
    auto_cover_media_id UUID REFERENCES media_files(id) ON DELETE SET NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS smart_search_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id UUID REFERENCES media_files(id) ON DELETE CASCADE,
    embedding vector(512) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(media_id)
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
```

---

## 6. Project Directory Structure

```text
hellomyphotos/
├── frontend/
│   ├── src/
│   │   ├── lib/            # Stores, typed API client, Lightbox, Grid, Modals
│   │   └── routes/         # /folder, /timeline, /search, /people, /share, /admin
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── config/         # Postgres connection & DDL migrations, Redis, CPU config
│   │   ├── cron/           # Analytics flush cron & periodic directory scanner
│   │   ├── modules/
│   │   │   ├── admin/      # Admin endpoints: queues, watermarks, users, settings
│   │   │   ├── analytics/  # Redis analytics buffer & GeoIP visit breakdown
│   │   │   ├── auth/       # JWT authentication & cookie verification
│   │   │   ├── media/      # Sharp resizing, dynamic watermarking, ZIP streaming, OG
│   │   │   ├── ml/         # Immich ML client, DBSCAN clustering, CLIP smart search
│   │   │   ├── scanner/    # Directory walker, cooldowns, and DB sync
│   │   │   ├── shares/     # Multi-entity sharing & access request workflows
│   │   │   └── timeline/   # Chronological EXIF timeline service
│   │   ├── queue/          # BullMQ queue definitions and workers
│   │   ├── utils/          # GeoIP, mailer, user agent parser, lockdown helper
│   │   ├── app.ts          # Fastify application setup & plugins
│   │   └── server.ts       # Server entrypoint
│   └── package.json
├── scripts/
│   ├── backup.sh           # Manual database backup script
│   ├── restore.sh          # Interactive database restore script
│   └── download-geoip.sh   # MaxMind GeoLite2 database downloader
├── volumes/
│   ├── media_ro/           # Host photos mount (:ro)
│   ├── cache_rw/           # 1080p, 480p, watermarks, OG, avatars, temp zips
│   ├── pg_data/            # PostgreSQL database files
│   ├── backups/            # Automated and manual .sql.gz database dumps
│   ├── geoip/              # MaxMind GeoLite2 MMDB files
│   ├── redis_data/         # Redis persistence
│   └── ml_cache/           # Immich ML ONNX model weights
├── docker-compose.yml       # Production stack definition
└── docker-compose.dev.yml   # Hot-reloading development stack
```
