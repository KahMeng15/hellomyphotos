# hellomyphotos Technical Documentation

Welcome to the comprehensive technical documentation for **hellomyphotos**, a directory-first, high-performance gallery engine. 

## Table of Contents
- [1. System Overview & Core Goals](#1-system-overview--core-goals)
- [2. Technical Stack Architecture](#2-technical-stack-architecture)
- [3. Detailed Functional Requirements](#3-detailed-functional-requirements)
  - [3.1. Directory Preservation & On-Demand Folder Scanning](#31-directory-preservation--on-demand-folder-scanning)
  - [3.2. Compression, Asset Pipeline & Low-Bandwidth Delivery](#32-compression-asset-pipeline--low-bandwidth-delivery)
  - [3.3. Facial Recognition Pipeline](#33-facial-recognition-pipeline)
  - [3.4. Smart Semantic Search (CLIP Embeddings)](#34-smart-semantic-search-clip-embeddings)
  - [3.5. Dynamic Watermark Studio](#35-dynamic-watermark-studio)
  - [3.6. Granular Sharing, Access Requests & Bulk Downloads](#36-granular-sharing-access-requests--bulk-downloads)
  - [3.7. Usage Analytics & GeoIP Tracking](#37-usage-analytics--geoip-tracking)
  - [3.8. Timeline Chronological Engine](#38-timeline-chronological-engine)
  - [3.9. Admin Operations & Queue Management](#39-admin-operations--queue-management)
- [4. Resource Control & Settings API](#4-resource-control--settings-api)
- [5. Database Schema (PostgreSQL + `pgvector`)](#5-database-schema-postgresql--pgvector)
- [6. Project Directory Structure](#6-project-directory-structure)
- [7. Local Development Guide](#7-local-development-guide)
- [8. Development Checklist](#8-development-checklist)
- [9. Pre-Deployment Checklist](#9-pre-deployment-checklist)
- [10. Docker Compose Production Runbook](#10-docker-compose-production-runbook)
- [11. Stress Testing & Reliability](#11-stress-testing--reliability)

---

## 1. System Overview & Core Goals

The goal of this project is to build a self-hosted, directory-first photo gallery that reads directly from existing disk folder hierarchies without moving or altering files. It combines Google Photos-like UI speed, AI-driven facial recognition, semantic natural-language image search (CLIP), dynamic watermark generation, granular multi-entity sharing, expired share access workflows, and comprehensive GeoIP visitor analytics—all engineered to operate smoothly under heavy concurrent traffic on constrained server resources.

---

## 2. Technical Stack Architecture

**Tech Stack:** SvelteKit (Frontend) • Node.js / Fastify / TypeScript (Backend) • Redis • PostgreSQL + `pgvector` • Immich ML (AI Engine) • BullMQ (Queues) • MaxMind GeoLite2 (GeoIP)
**Deployment:** Docker Containerized Environment (`docker-compose`)

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

* **Disk Integrity:** Read-only (`:ro`) volume mounting of host folders (`volumes/media_ro`). Zero file modifications or moves on original disk paths.
* **On-Demand Scan Logic:**
  1. Trigger folder index when an end-user navigates to `/folder/*`.
  2. Query Redis for key: `scan_cooldown:<folder_path>`.
  3. **If Key Exists:** Serve directory tree directly from PostgreSQL cache.
  4. **If Key Missing:** Set `scan_cooldown:<folder_path>` in Redis with a 60-second TTL. Push a background job via BullMQ to run `fs.promises.readdir` on that specific path and insert/update missing file entries in PostgreSQL.
* **Worker Concurrency:** Sequential folder scanning (`SCANNER_CONCURRENCY=1`) avoids database locking contention while allowing background thumbnail, metadata, and ML pipelines to process concurrently.
* **Periodic Background Scanning:** A scheduled cron job (`periodicScanner.ts`) periodically inspects root folders for new files added via FTP/SMB/rsync.
* **Symbolic Links:** Safe handling of `fs.Dirent.isSymbolicLink()` to prevent recursive directory loops.
* **Garbage Collection:** Scans detect deleted files and prune orphaned database rows, embeddings, and cached thumbnails.

### 3.2. Compression, Asset Pipeline & Low-Bandwidth Delivery

* **Pre-Processing Pipeline:** Background workers process newly indexed files using `sharp` (C++ bindings), native HEIC decoding, and `ffmpeg`:
  * **Blurhash / Micro-placeholder:** Compact string representation stored directly in PostgreSQL for instant layout rendering.
  * **Display Preview:** WebP format, max 1080p, quality 80 (~80–120 KB) with EXIF/GPS metadata stripped. Saved to `./volumes/cache_rw/1080p/`.
  * **Low-Res Mobile Preview:** WebP format, max 480p, quality 65 (~30 KB) stored in `./volumes/cache_rw/480p/`.
  * **Video Support & Transcoding:** WebP thumbnail extraction via `ffmpeg`. Direct streaming via HTTP Range requests, with optional hardware-accelerated transcoding (`LIBVA_DRIVER_NAME`) producing optimized MP4/WebM versions.
  * **OpenGraph (OG) Images:** Dynamic social preview generation for shared folders and photos cached under `./volumes/cache_rw/og/`.
* **Low-Bandwidth Mode:** Client-side toggle forcing 480p delivery across grids and lightboxes to conserve mobile data.

### 3.3. Facial Recognition Pipeline

* **Detection & Extraction:** High-performance detection powered by SCRFD and Buffalo_L via the local Immich ML container (`http://machine-learning:3003/predict`).
* **Workflow:**
  1. Background worker sends 480p preview to ML container.
  2. Receives bounding box coordinates and 512-float vector embeddings.
  3. Saves face entries to PostgreSQL in `face_embeddings` with `vector(512)` and creates cropped face avatars via `faceThumbnailQueue`.
  4. Runs DBSCAN clustering to group matching face vectors under unified records in the `people` table.
* **People Management:** Admins and users can rename individuals, select custom cover faces/photos, merge duplicate clusters, and share person albums.

### 3.4. Smart Semantic Search (CLIP Embeddings)

* **Natural-Language Search:** Users can query photo libraries using semantic phrases (e.g. "red sports car", "sunset over the ocean", "dog on sofa") without relying on filenames or EXIF tags.
* **Architecture:**
  1. The BullMQ `smartSearchQueue` dispatches preview images to Immich ML CLIP text-image models.
  2. 512-dimensional vector embeddings are stored in `media_files.clip_embedding` and `smart_search_embeddings`.
  3. Fast search queries use PostgreSQL `pgvector` HNSW index (`idx_media_files_clip_embedding USING hnsw (clip_embedding vector_cosine_ops)`).

### 3.5. Dynamic Watermark Studio

* **Template-Driven Engine:** Managed via the `watermark_templates` table and interactive admin UI (`/admin/watermark`).
* **Customization Options:**
  * Type: Text or Image logo.
  * Dynamic Tokens: Supports `{year}`, `{copyright}`, and custom text content.
  * Typography: Built-in fonts including Instrument Sans, Cabinet Grotesk, Playfair Display, and Great Vibes.
  * Placement & Styling: Anchor positioning, insets, scale mode (`proportional_long_edge`, fixed), rotation, opacity, drop shadow, background pill box, and repeated pattern tiling (`is_tiled`).
  * Restricted Download Tiers: Apply watermarks to previews and downloads, or enforce a restricted download tier (e.g. restrict downloads to watermarked 1080p while safeguarding raw originals).
* **High Performance Caching:** Watermarked derivatives are cached in `./volumes/cache_rw/watermarked/` and invalidated/regenerated on demand.

### 3.6. Granular Sharing, Access Requests & Bulk Downloads

* **Multi-Entity Sharing:** Share links (`shared_folders`) support:
  * Whole folder shares (`folder_path`)
  * Individual media item shares (`media_id`)
  * Person cluster shares (`person_id`)
* **Security & Access Controls:** Password protection, expiration timestamps, downloadable flags (`allow_download_images`, `allow_download_folder`), GPS stripping, and system lockdown mode.
* **Expired Share Access Requests:** Visitors navigating to an expired or locked share can submit their name, email, and a note via `share_access_requests`. Gallery owners receive email notifications via SMTP (`backend/src/utils/mailer.ts`).
* **Bulk ZIP Downloads:** Streaming ZIP generation (`/api/media/download-zip`) allowing visitors to download entire folders in one archive.

### 3.7. Usage Analytics & GeoIP Tracking

* **High-Throughput Ingestion:** Analytics counts are buffered in Redis memory (`HINCRBY`) to prevent PostgreSQL write contention during traffic spikes.
* **Detailed Per-Visit Tracking:** `analytics_visits` captures:
  * Device ID fingerprinting, browser, OS, and device type.
  * MaxMind GeoLite2 IP resolution (country, city, ASN) without storing exposed raw IPs.
  * Network & UX timings: `page_load_ms`, `photo_view_ms`, `session_duration_s`, `scroll_depth_pct`.
  * Bandwidth optimization metrics: `cache_bytes_saved`, `cache_hits`, `cache_misses`.
* **Periodic Batch Flush:** Scheduled cron flushes Redis counters into `media_analytics` and `analytics_visits` every 30 seconds.

### 3.8. Timeline Chronological Engine

* Chronological browsing route (`/timeline`) that aggregates photo assets grouped by year and month using normalized EXIF timestamp headers, enabling infinite scrolling through memories.

### 3.9. Admin Operations & Queue Management

* **BullMQ Queue Dashboard (`/admin/queues`):** Real-time monitoring of queue status (active, waiting, completed, failed), worker concurrency controls, manual job retry, queue purging, and batch ingestion mode.
* **User Management & RBAC (`/admin/users`):** User creation, role assignments (`admin`, `super_admin`, `user`, `viewer`), and folder access restrictions (`user_folder_access`).
* **Centralized System Logs (`/admin/logs`):** Structured logging of background worker errors, API security warnings, and authentication audits.

---

## 4. Resource Control & Settings API

To prevent background jobs from overwhelming host CPUs and memory:

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

Worker concurrency can also be pre-configured in `.env`:
- `SCANNER_CONCURRENCY`: Default `1` (sequential scan prevents lock contention)
- `METADATA_CONCURRENCY`: Default `2` (I/O bound EXIF extraction)
- `THUMBNAIL_CONCURRENCY`: Default `1` (Sharp image resizing)
- `VIDEO_CONCURRENCY`: Default `1` (FFmpeg transcoding)
- `SMART_SEARCH_CONCURRENCY`: Default `1` (CLIP embedding generation)
- `FACE_DETECTION_CONCURRENCY`: Default `1` (SCRFD face detection)
- `FACE_THUMBNAIL_CONCURRENCY`: Default `2` (Face avatar cropping)
- `FACIAL_RECOGNITION_CONCURRENCY`: Default `1` (DBSCAN clustering)

---

## 5. Database Schema (PostgreSQL + `pgvector`)

The live schema is managed idempotently via `backend/src/config/db.ts` and initialized on empty volumes by `volumes/pg_init/`:

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS ltree;

-- Users & Access Control
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

-- Media Files & Index
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
    bounding_box JSONB, -- {x, y, w, h}
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

---

## 7. Local Development Guide

Two workflows are supported for local development:
1. **Full-containerized development** (recommended) — `docker-compose.dev.yml` runs *everything* in Docker with hot-reloading via bind mounts.
2. **Non-Docker development** — run foundational services (Postgres, Redis, Immich ML) in Docker and run Fastify + SvelteKit directly on your host.

### 7.1 Setup Local Volumes & GeoIP
```bash
mkdir -p volumes/media_ro/test_folder
# Drop some .jpg, .png, or .mp4 files into volumes/media_ro/test_folder

# Optional: Download GeoLite2 databases for analytics testing
./scripts/download-geoip.sh
```

### 7.2 Option A — Full Containerized Stack (Hot-Reload)
`docker-compose.dev.yml` bind-mounts `./frontend` and `./backend` into the containers with live HMR:

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d --build
```

| Service | URL |
| --- | --- |
| Frontend UI (Vite dev server) | http://localhost:8000 |
| Backend API | internal — proxied by the frontend via `BACKEND_PROXY_URL=http://backend:3000` |
| Redis | http://localhost:8003 |
| Immich ML | http://localhost:8004 |

### 7.3 Option B — Non-Docker Local Development (Fastest HMR)
Run Postgres, Redis, and Immich ML in Docker:

```bash
# Postgres with pgvector
docker run -d --name hmp-pg \
  -e POSTGRES_USER=hellomyphotos -e POSTGRES_PASSWORD=hellomyphotos_secret -e POSTGRES_DB=hellomyphotos \
  -p 5432:5432 \
  -v "$PWD/volumes/pg_init:/docker-entrypoint-initdb.d:ro" \
  ankane/pgvector:v0.5.1

# Redis
docker run -d --name hmp-redis -p 6379:6379 redis:7-alpine

# Immich ML
docker run -d --name hmp-ml -p 3003:3003 ghcr.io/immich-app/immich-machine-learning:release
```

Configure `backend/.env.local`:
```env
DB_PORT=5432
REDIS_PORT=6379
IMMICH_ML_URL=http://localhost:3003
APP_DOMAIN=http://localhost:8000
```

Start both applications:
```bash
cd backend && npm install && npm run dev     # API on http://localhost:3000
cd frontend && npm install && npm run dev     # UI on http://localhost:5173
```

---

## 8. Development Checklist

### Phase 1: Foundation & Data Layer
- [x] Initialize Node.js/Fastify backend and SvelteKit frontend skeletons.
- [x] Set up `docker-compose.yml` with Postgres, Redis, Immich ML, and automated DB backup container.
- [x] Configure PostgreSQL with `pgvector` and `ltree` extensions.
- [x] Implement database schema bootstrapping with idempotent DDL migrations.
- [x] Create read-only (`:ro`) volume mounts for original media.

### Phase 2: Directory Scanning & Queueing
- [x] Implement Fastify API endpoint for `/folder/*` navigation.
- [x] Implement Redis `scan_cooldown` logic for on-demand scanning.
- [x] Setup BullMQ workers and queues for thumbnailing, metadata, video, ML, and search.
- [x] Implement `fs.Dirent.isSymbolicLink()` handling to avoid infinite loops.
- [x] Implement Garbage Collection: prune orphaned database rows and cached assets.
- [x] Implement Periodic Background Scanning cron job.

### Phase 3: Media Processing Pipeline
- [x] Integrate `sharp` in BullMQ worker to generate Blurhashes.
- [x] Integrate `sharp` to generate 1080p and 480p WebP previews, stripping EXIF data.
- [x] Integrate `ffmpeg` to generate WebP thumbnails and transcoded video streams.
- [x] Build Fastify endpoints to serve images with HTTP caching headers (`Cache-Control`).
- [x] Build Fastify endpoint for video streaming using HTTP Range requests.

### Phase 4: Frontend Virtual Grid & Navigation
- [x] Build SvelteKit frontend layout and routing (`/folder/[...path]`).
- [x] Implement virtualized grid rendering thousands of thumbnails smoothly.
- [x] Implement Blurhash decoding for instant placeholder layouts.
- [x] Build Lightbox view with support for toggling Low-Bandwidth (480p) mode.
- [x] Implement Timeline view (`/timeline`) for chronological browsing.

### Phase 5: Machine Learning & Facial Recognition
- [x] Verify `immich-machine-learning` container connectivity.
- [x] Create BullMQ worker to send previews to ML container for face detection.
- [x] Store face embeddings using `vector(512)` and crop face avatars.
- [x] Implement DBSCAN clustering queries to group matching faces into `people`.
- [x] Build frontend UI to group photos by Person ID with renaming and merging.
- [x] Implement CLIP smart natural language search with HNSW index.

### Phase 6: Sharing, Watermarking & Analytics
- [x] Build API routes for creating share links with granular permissions (expiry, download limits, password).
- [x] Build Watermark Studio with template management, custom typography, dynamic SVG overlays, and restricted download tiers.
- [x] Implement streaming ZIP downloads for shared folders.
- [x] Build expired share access request workflow with SMTP mailer notifications.
- [x] Implement Redis buffered analytics and 30-second cron flush.
- [x] Implement MaxMind GeoLite2 GeoIP resolution and device fingerprinting.
- [x] Build Admin UI for queues, watermark templates, analytics, faces, and settings.

---

## 9. Pre-Deployment Checklist

- [ ] Ensure `.env` is fully populated with secure secrets and **never** committed.
- [ ] Change `POSTGRES_PASSWORD` and `DB_PASS` to a secure, randomly generated string.
- [ ] Set `JWT_SECRET` and `COOKIE_SECRET` using `openssl rand -hex 48`.
- [ ] Verify that your primary media volume is strictly mounted as Read-Only (`:ro`).
- [ ] Ensure `volumes/cache_rw`, `volumes/backups`, and `volumes/geoip` have write permissions.
- [ ] Run `./scripts/download-geoip.sh` if using visitor location analytics.
- [ ] Configure `SMTP_*` variables if using share access request notifications.
- [ ] Ensure reverse proxy (Caddy / Nginx / Traefik) passes `Range` headers for video streaming.

---

## 10. Docker Compose Production Runbook

### 10.1 Services and Ports

| Service | Host Port | Purpose |
| --- | --- | --- |
| `frontend` | `8000` | SvelteKit UI + reverse proxy to Fastify backend |
| `redis` | `8003` | Diagnostics/debugging only — do not expose publicly |
| `machine-learning` | `8004` | Diagnostics/debugging only — do not expose publicly |
| `backend` | internal | Fastify REST API, auth, media streaming |
| `backend-worker` | internal | BullMQ workers for image, video, search, and ML tasks |
| `postgres` | internal | PostgreSQL with `pgvector` extension |
| `db-backup` | internal | Automated daily database backups into `./volumes/backups/` |

### 10.2 First Boot
```bash
cp .env.example .env
# Edit .env and set strong secrets
mkdir -p volumes/media_ro volumes/cache_rw
./scripts/download-geoip.sh # optional for GeoIP analytics
docker compose up -d --build
```
On first boot, PostgreSQL initializes the schema. Default admin login:
- **Email:** `admin@example.com`
- **Password:** `admin` *(Change immediately upon login!)*

### 10.3 Backup & Restore Procedures

**Automated Backups:**
The `db-backup` container runs daily, keeping up to 30 daily backups in `./volumes/backups/daily/`.

**Manual Backup:**
```bash
./scripts/backup.sh
```

**Restoring from Backup:**
```bash
./scripts/restore.sh volumes/backups/daily/<backup-filename>.sql.gz
```

### 10.4 Updating the Stack
```bash
docker compose pull
docker compose up -d
```

---

## 11. Stress Testing & Reliability

A 100k-record stress test script verifies system behavior under extreme queue loads:

```bash
# Seed 100k mock records into backend BullMQ queue
docker compose exec backend npx tsx scripts/stress_test_100k.ts

# Clean up stress test records and failed jobs
docker compose exec backend npx tsx scripts/cleanup_stress_test.ts
```
