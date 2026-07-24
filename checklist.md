# Development Checklist

## Phase 1: Foundation & Data Layer
- [x] Initialize Node.js/Fastify backend and SvelteKit frontend skeletons.
- [x] Set up `docker-compose.yml` with Postgres, Redis, and Immich ML.
- [x] Configure PostgreSQL with `pgvector` and `ltree` extensions.
- [x] Implement database migrations for `media_files`, `face_embeddings`, `shared_folders`, and `media_analytics`.
- [x] Create read-only (`:ro`) volume mounts in Docker for the media directory.
- [x] Create a separate read-write volume for the thumbnail and generated assets cache.

## Phase 2: Directory Scanning & Queueing
- [x] Implement Fastify API endpoint to catch `/folder/*` navigation.
- [x] Implement Redis `scan_cooldown` logic for on-demand scanning.
- [x] Setup BullMQ workers and queues.
- [x] Write the background worker script using `fs.promises.readdir` to scan directories.
- [x] Implement `fs.Dirent.isSymbolicLink()` handling to avoid infinite loops.
- [x] Implement Garbage Collection: prune orphaned database rows, embeddings, and cached thumbnails for deleted files.
- [x] Implement Periodic Background Scanning cron job, configurable via admin settings.
- [x] **Test:** Mount a test directory with 1,000 images/videos, trigger a scan, and verify all records appear in the database without duplicates.

## Phase 3: Media Processing Pipeline
- [x] Integrate `sharp` in a BullMQ worker to generate Blurhashes.
- [x] Integrate `sharp` to generate 1080p and 480p WebP previews, stripping EXIF data, saving to the cache volume.
- [x] Integrate `ffmpeg` to generate WebP thumbnails from video files.
- [x] Build Fastify endpoints to serve images efficiently from cache with proper HTTP caching headers (`Cache-Control`).
- [x] Build Fastify endpoint for Video direct streaming using HTTP range requests.
- [x] **Test:** Verify EXIF data is stripped from outputs, videos stream properly, and memory usage remains stable during batch processing.

## Phase 4: Frontend Virtual Grid & Navigation
- [x] Build SvelteKit frontend layout and routing (`/folder/[...path]`).
- [x] Implement a highly performant virtualized grid (e.g., using `@tanstack/svelte-virtual`) to render thousands of thumbnails without DOM lag.
- [x] Implement Blurhash decoding on the frontend for instant loading states.
- [x] Build the Lightbox view with support for toggling the Low-Bandwidth (480p) mode.
- [x] Implement Video playback within the Lightbox.
- [x] **Test:** Scroll through a folder with 5,000 media items to ensure 60fps scrolling and no browser crashes.

## Phase 5: Machine Learning & Facial Recognition
- [x] Verify `immich-machine-learning` container connectivity in Docker network.
- [x] Create a BullMQ worker to send 480p WebPs to the ML container's `/predict` endpoint.
- [x] Process the returned embeddings and save them to PostgreSQL using `vector(512)`.
- [x] Implement pgvector DBSCAN/cosine similarity queries to cluster identical faces.
- [x] Build frontend UI to group photos by Person ID.
- [x] **Test:** Upload photos of the same person across different ages/lighting and verify they cluster correctly.

## Phase 6: Sharing, Watermarking & Analytics
- [x] Build API routes for creating share links with permissions (expiry, download limits).
- [x] Implement dynamic watermarking using `sharp.composite()` on the fly for shared streams (bypassing disk write).
- [x] Implement Redis buffered analytics (`HINCRBY`) and the 30-second cron job to flush to PostgreSQL.
- [x] Build an Admin UI to monitor resource usage, set `scan_interval`, and adjust CPU limits (`worker.concurrency`).
- [x] **Test:** Generate a shared link with watermarking, access it from an incognito window, and verify the stream contains the watermark and analytics are logged.
