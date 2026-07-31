# hellomyphotos Technical Documentation

Welcome to the comprehensive technical documentation for **hellomyphotos**, a directory-first, high-performance gallery engine. 

## Table of Contents
- [1. System Overview & Core Goals](#1-system-overview--core-goals)
- [2. Technical Stack Architecture](#2-technical-stack-architecture)
- [3. Detailed Functional Requirements](#3-detailed-functional-requirements)
- [4. Resource Control & Settings API](#4-resource-control--settings-api)
- [5. Database Schema](#5-database-schema)
- [6. Project Directory Structure](#6-project-directory-structure)
- [7. Local Development Guide](#7-local-development-guide)
- [8. Development Checklist](#8-development-checklist)
- [9. Pre-Deployment Checklist](#9-pre-deployment-checklist)

---

## 1. System Overview & Core Goals

The goal of this project is to build a self-hosted, directory-first photo gallery that reads directly from existing disk folder hierarchies without moving files. It combines Google Photos-like UI speed, facial recognition capabilities, dynamic image watermarking, public folder sharing controls, and analytics tracking—all engineered to operate smoothly under heavy concurrent traffic on constrained server resources.

---

## 2. Technical Stack Architecture

**Tech Stack:** SvelteKit (Frontend) • Node.js / Fastify / TypeScript (Backend) • Redis • PostgreSQL + `pgvector` • Immich ML (AI Engine)
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

```text
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

---

## 7. Local Development Guide

To work on hellomyphotos locally, it is recommended to run the foundational services (Postgres, Redis, Immich ML) in Docker, while running the Node.js Backend and SvelteKit Frontend directly on your local machine for fast Hot-Module Reloading (HMR).

### Prerequisites
- **Node.js**: v18 or newer
- **Docker** & **Docker Compose**: Installed and running

### 7.1 Setup Local Volumes
Before starting, ensure you place some test photos in your local media folder so the scanner has something to read.
The `docker-compose.yml` mounts `./volumes/media_ro` by default.

```bash
mkdir -p volumes/media_ro/test_folder
# Drop some .jpg, .png, or .mp4 files into volumes/media_ro/test_folder
```

### 7.2 Start Foundational Services
Boot up PostgreSQL, Redis, and the Machine Learning container:
```bash
docker-compose up -d postgres redis machine-learning
```
*Wait a few seconds for PostgreSQL to initialize the schema via the `pg_init/01-init.sql` script.*

### 7.3 Start the Backend (Fastify)
The backend handles the API, background workers, and ML queuing.
```bash
cd backend
npm install
npm run dev
```
*The backend should now be listening on `http://localhost:3000`.*

### 7.4 Start the Frontend (SvelteKit)
Open a new terminal window to start the frontend UI.
```bash
cd frontend
npm install
npm run dev
```
*The frontend should now be available at `http://localhost:5173`. Open this in your browser.*

### 7.5 Testing the Flow
1. Open `http://localhost:5173/folder/test_folder` in your browser.
2. Check your backend terminal: you should see the `ScannerService` indexing the files and pushing jobs to the BullMQ workers.
3. Check your `volumes/cache_rw` folder: you should see `1080p` and `480p` WebP thumbnails appearing.
4. Navigate to the **Faces** tab in the UI to see the clustered facial recognition results generated by the Immich ML container.

---

## 8. Development Checklist

### Phase 1: Foundation & Data Layer
- [x] Initialize Node.js/Fastify backend and SvelteKit frontend skeletons.
- [x] Set up `docker-compose.yml` with Postgres, Redis, and Immich ML.
- [x] Configure PostgreSQL with `pgvector` and `ltree` extensions.
- [x] Implement database migrations for `media_files`, `face_embeddings`, `shared_folders`, and `media_analytics`.
- [x] Create read-only (`:ro`) volume mounts in Docker for the media directory.
- [x] Create a separate read-write volume for the thumbnail and generated assets cache.

### Phase 2: Directory Scanning & Queueing
- [x] Implement Fastify API endpoint to catch `/folder/*` navigation.
- [x] Implement Redis `scan_cooldown` logic for on-demand scanning.
- [x] Setup BullMQ workers and queues.
- [x] Write the background worker script using `fs.promises.readdir` to scan directories.
- [x] Implement `fs.Dirent.isSymbolicLink()` handling to avoid infinite loops.
- [x] Implement Garbage Collection: prune orphaned database rows, embeddings, and cached thumbnails for deleted files.
- [x] Implement Periodic Background Scanning cron job, configurable via admin settings.
- [x] **Test:** Mount a test directory with 1,000 images/videos, trigger a scan, and verify all records appear in the database without duplicates.

### Phase 3: Media Processing Pipeline
- [x] Integrate `sharp` in a BullMQ worker to generate Blurhashes.
- [x] Integrate `sharp` to generate 1080p and 480p WebP previews, stripping EXIF data, saving to the cache volume.
- [x] Integrate `ffmpeg` to generate WebP thumbnails from video files.
- [x] Build Fastify endpoints to serve images efficiently from cache with proper HTTP caching headers (`Cache-Control`).
- [x] Build Fastify endpoint for Video direct streaming using HTTP range requests.
- [x] **Test:** Verify EXIF data is stripped from outputs, videos stream properly, and memory usage remains stable during batch processing.

### Phase 4: Frontend Virtual Grid & Navigation
- [x] Build SvelteKit frontend layout and routing (`/folder/[...path]`).
- [x] Implement a highly performant virtualized grid (e.g., using `@tanstack/svelte-virtual`) to render thousands of thumbnails without DOM lag.
- [x] Implement Blurhash decoding on the frontend for instant loading states.
- [x] Build the Lightbox view with support for toggling the Low-Bandwidth (480p) mode.
- [x] Implement Video playback within the Lightbox.
- [x] **Test:** Scroll through a folder with 5,000 media items to ensure 60fps scrolling and no browser crashes.

### Phase 5: Machine Learning & Facial Recognition
- [x] Verify `immich-machine-learning` container connectivity in Docker network.
- [x] Create a BullMQ worker to send 480p WebPs to the ML container's `/predict` endpoint.
- [x] Process the returned embeddings and save them to PostgreSQL using `vector(512)`.
- [x] Implement pgvector DBSCAN/cosine similarity queries to cluster identical faces.
- [x] Build frontend UI to group photos by Person ID.
- [x] **Test:** Upload photos of the same person across different ages/lighting and verify they cluster correctly.

### Phase 6: Sharing, Watermarking & Analytics
- [x] Build API routes for creating share links with permissions (expiry, download limits).
- [x] Implement dynamic watermarking using `sharp.composite()` on the fly for shared streams (bypassing disk write).
- [x] Implement Redis buffered analytics (`HINCRBY`) and the 30-second cron job to flush to PostgreSQL.
- [x] Build an Admin UI to monitor resource usage, set `scan_interval`, and adjust CPU limits (`worker.concurrency`).
- [x] **Test:** Generate a shared link with watermarking, access it from an incognito window, and verify the stream contains the watermark and analytics are logged.

---

## 9. Pre-Deployment Checklist

Before deploying this monolithic stack to a production server, walk through this critical checklist to ensure stability, security, and performance.

### 9.1 Environment Variables & Security
- [ ] Ensure `.env` is fully populated and **never** committed to version control.
- [ ] Change `POSTGRES_PASSWORD` and `DB_PASS` to a secure, randomly generated string.
- [ ] Configure `VITE_API_URL` to point to your production backend domain (e.g., `https://api.mygallery.com`).
- [ ] Configure `REDIS_PASSWORD` if exposing Redis outside the Docker network.

### 9.2 Docker & Volume Mounts
- [ ] Verify that your primary media volume is strictly mounted as Read-Only (`:ro`) in `docker-compose.yml` to prevent accidental deletions of your original files.
- [ ] Verify that `cache_rw` has the correct read/write permissions for the Docker user.
- [ ] Set resource constraints in `docker-compose.yml` (e.g., `mem_limit` or `cpus`) so that `sharp` and `ffmpeg` workers do not completely starve the host server OS.

### 9.3 Reverse Proxy & SSL (e.g., Caddy, Nginx, Traefik)
- [ ] Ensure the backend (`port 3000`) and frontend (`port 5173` or SvelteKit node adapter port) are cleanly proxied.
- [ ] Configure SSL/TLS certificates (e.g., Let's Encrypt).
- [ ] Ensure the reverse proxy accepts `Range` headers properly so that HTTP Video Streaming works correctly on Apple/Safari devices.
- [ ] Ensure the proxy `client_max_body_size` is large enough if you ever plan on building a direct web upload feature.

### 9.4 Backend Processing & Load Testing
- [ ] Validate `settings:max_cpu_cores` in the Admin Dashboard. Do not set this higher than your physical CPU cores, or you will experience severe throttling during mass uploads.
- [ ] Test the background cron job (`analyticsCron`) to ensure Redis views are successfully flushing to PostgreSQL.
- [ ] Run a test scan on a massive directory (e.g., 20,000 files) and monitor RAM consumption. If Fastify crashes due to OOM (Out Of Memory), you may need to implement pagination/batching in the `ScannerService.scanDirectory` array loops.

### 9.5 Machine Learning Thresholds
- [ ] Test the pgvector clustering query (`<=> $1::vector < 0.6`). If faces are grouping incorrectly (false positives), adjust the distance threshold to `0.5`. If it's failing to group identical people (false negatives), increase it to `0.65`.

### 9.6 Backup Strategy
- [ ] Create a cron job on the host to run `pg_dump` on the `hellomyphotos` database daily.
- [ ] You do **not** need to backup the `cache_rw` volume, as it can be perfectly reconstructed by deleting it and triggering a new scan.
