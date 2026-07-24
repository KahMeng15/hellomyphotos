# hellomyphotos Technical Product Requirement Document (PRD)

**Project Name:** Directory-First High-Performance Gallery Engine

**Tech Stack:** SvelteKit (Frontend) • Node.js / Fastify / TypeScript (Backend) • Redis • PostgreSQL + `pgvector` • Immich ML (AI Engine)

**Deployment:** Docker Containerized Environment (`docker-compose`)

---

## 1. System Overview & Core Goals

The goal of this project is to build a self-hosted, directory-first photo gallery that reads directly from existing disk folder hierarchies without moving files. It combines Google Photos-like UI speed, facial recognition capabilities, dynamic image watermarking, public folder sharing controls, and analytics tracking—all engineered to operate smoothly under heavy concurrent traffic on constrained server resources.

---

## 2. Technical Stack Architecture

```
                                  ┌───────────────────────────┐
                                  │      Client Browsers      │
                                  └─────────────┬─────────────┘
                                                │ (HTTP / SSE / WebSockets)
                 ┌──────────────────────────────┴──────────────────────────────┐
                 ▼                                                             ▼
┌─────────────────────────────────┐                           ┌─────────────────────────────────┐
│     SvelteKit Frontend App      │                           │   Node.js (Fastify) Backend     │
│   (SSR / Client Virtual Grid)   │                           │     (API, Auth, Stream, Queue)  │
└─────────────────────────────────┘                           └────────────────┬────────────────┘
                                                                               │
                                ┌──────────────────────────────────────────────┼──────────────────────────────────────────────┐
                                ▼                                              ▼                                              ▼
                 ┌──────────────────────────────┐               ┌──────────────────────────────┐               ┌──────────────────────────────┐
                 │       Redis Container        │               │    PostgreSQL + pgvector     │               │   Immich ML Container        │
                 │ (Cache, Cooldowns, BullMQ)   │               │   (Metadata, Shares, Logs)   │               │  (Face Detection / Vectors)  │
                 └──────────────────────────────┘               └──────────────────────────────┘               └──────────────────────────────┘

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
* **Periodic Background Scanning:** A scheduled cron job (configurable via admin settings) will periodically scan the root directory to find new files dropped via FTP/SMB, complementing on-demand scans.
* **Symbolic Links:** The scanner will detect and safely handle `fs.Dirent.isSymbolicLink()` to prevent infinite loops.
* **Garbage Collection:** Scans will identify missing files and prune orphaned database rows, embeddings, and cached thumbnails.



### 3.2. Compression, Asset Pipeline & Low-Bandwidth Delivery

* **Pre-Processing Pipeline:** Background workers process newly indexed files using `sharp` (C++ bindings) and `ffmpeg` (spawned child processes):
* **Blurhash / Micro-placeholder:** String (~2 KB) saved directly into PostgreSQL for instant layout rendering.
* **Thumbnail Cache Directory:** A dedicated read-write Docker volume for storing generated thumbnails and cached assets, preventing RAM exhaustion.
* **Display Preview:** WebP format, max 1080p, quality 80 (~80–120 KB). Metadata headers (EXIF/GPS) explicitly stripped. Saved to the cache directory.
* **Low-Res Mobile Preview:** WebP format, max 480p, quality 65 (~30 KB). Saved to the cache directory.
* **Video Support:** Video files will generate a WebP thumbnail via `ffmpeg`. Direct streaming (HTTP range requests) will be supported for playback.


* **Low-Bandwidth Mode:** Client settings toggle to force serving 480p low-res previews instead of 1080p previews across grid items and lightboxes.

### 3.3. Facial Recognition Pipeline

* **Integration:** Async HTTP POST calls to local `immich-machine-learning` microservice running at `http://machine-learning:3003/predict`.
* **Workflow:**
1. Background worker sends WebP preview image to ML container (`model: "buffalo_l"`).
2. Receive bounding box coordinates and a 512-float face embedding array.
3. Store face coordinates and vector embeddings inside PostgreSQL using `vector(512)`.
4. Run DBSCAN clustering queries in PostgreSQL via `pgvector` to group matching face vectors under unified Person IDs.



### 3.4. Dynamic Watermarking Engine

* Keep cached WebP thumbnails clean on disk.
* For shared folders with `watermark_enabled = true`:
* Intercept thumbnail request streams in Fastify.
* Render text/logo overlay in-memory using `sharp().composite()`.
* Stream the watermarked image buffer directly to HTTP response stream without saving to disk.
* Enforce `Cache-Control: private, no-store` on watermarked preview responses.



### 3.5. Granular Folder Sharing & Expiration

* Admin creates share links with custom settings stored in `shared_folders` table:
* `expires_at` (Timestamp or Null)
* `allow_download` (Boolean: Enable/Disable folder or original file downloads)
* `watermark_enabled` (Boolean)
* `strip_gps_on_download` (Boolean: On-the-fly metadata stripping on raw download streams)
* `password_hash` (Optional HTTP-only cookie authentication for share access)



### 3.6. Usage Analytics & Tracking

* Log image views (`PREVIEW_1080P`, `PREVIEW_480P`) and original file downloads asynchronously.
* **Write Buffer:** Buffer analytics counts in Redis memory using `HINCRBY analytics:views <file_id> 1` to eliminate write locks on PostgreSQL.
* **Batch Worker:** A scheduled job flushes accumulated Redis analytics counts into PostgreSQL `media_analytics` tables every 30 seconds.

---

## 4. Resource Control & Settings API

To prevent worker tasks from starving host system resources:

```
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

```

---

## 6. Project Directory Structure (Node.js Backend)

```
/backend
├── src
│   ├── config/             # Environment variables, Redis & Postgres connections
│   ├── modules/
│   │   ├── analytics/      # Redis buffer & batch flushing logic
│   │   ├── auth/           # Admin JWT & Share token validation middlewares
│   │   ├── scanner/        # On-demand directory reader & scan cooldowns
│   │   ├── media/          # Sharp image resizing, dynamic watermarking & streaming
│   │   ├── ml/             # Immich HTTP client & pgvector facial matching
│   │   └── shares/         # Public link generation & expiration logic
│   ├── queue/              # BullMQ background workers (Thumbnail generation, FFmpeg)
│   ├── app.ts              # Fastify server entrypoint
│   └── routes.ts           # Unified API route registry
├── docker-compose.yml
├── Dockerfile
└── package.json

```