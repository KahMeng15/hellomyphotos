# Development Checklist

## Phase 1: Foundation & Data Layer
- [ ] Initialize Node.js/Fastify backend and SvelteKit frontend skeletons.
- [ ] Set up `docker-compose.yml` with Postgres, Redis, and Immich ML.
- [ ] Configure PostgreSQL with `pgvector` and `ltree` extensions.
- [ ] Implement database migrations for `media_files`, `face_embeddings`, `shared_folders`, and `media_analytics`.
- [ ] Create read-only (`:ro`) volume mounts in Docker for the media directory.
- [ ] Create a separate read-write volume for the thumbnail and generated assets cache.

## Phase 2: Directory Scanning & Queueing
- [ ] Implement Fastify API endpoint to catch `/folder/*` navigation.
- [ ] Implement Redis `scan_cooldown` logic for on-demand scanning.
- [ ] Setup BullMQ workers and queues.
- [ ] Write the background worker script using `fs.promises.readdir` to scan directories.
- [ ] Implement `fs.Dirent.isSymbolicLink()` handling to avoid infinite loops.
- [ ] Implement Garbage Collection: prune orphaned database rows, embeddings, and cached thumbnails for deleted files.
- [ ] Implement Periodic Background Scanning cron job, configurable via admin settings.
- [ ] **Test:** Mount a test directory with 1,000 images/videos, trigger a scan, and verify all records appear in the database without duplicates.

## Phase 3: Media Processing Pipeline
- [ ] Integrate `sharp` in a BullMQ worker to generate Blurhashes.
- [ ] Integrate `sharp` to generate 1080p and 480p WebP previews, stripping EXIF data, saving to the cache volume.
- [ ] Integrate `ffmpeg` to generate WebP thumbnails from video files.
- [ ] Build Fastify endpoints to serve images efficiently from cache with proper HTTP caching headers (`Cache-Control`).
- [ ] Build Fastify endpoint for Video direct streaming using HTTP range requests.
- [ ] **Test:** Verify EXIF data is stripped from outputs, videos stream properly, and memory usage remains stable during batch processing.

## Phase 4: Frontend Virtual Grid & Navigation
- [ ] Build SvelteKit frontend layout and routing (`/folder/[...path]`).
- [ ] Implement a highly performant virtualized grid (e.g., using `@tanstack/svelte-virtual`) to render thousands of thumbnails without DOM lag.
- [ ] Implement Blurhash decoding on the frontend for instant loading states.
- [ ] Build the Lightbox view with support for toggling the Low-Bandwidth (480p) mode.
- [ ] Implement Video playback within the Lightbox.
- [ ] **Test:** Scroll through a folder with 5,000 media items to ensure 60fps scrolling and no browser crashes.

## Phase 5: Machine Learning & Facial Recognition
- [ ] Verify `immich-machine-learning` container connectivity in Docker network.
- [ ] Create a BullMQ worker to send 480p WebPs to the ML container's `/predict` endpoint.
- [ ] Process the returned embeddings and save them to PostgreSQL using `vector(512)`.
- [ ] Implement pgvector DBSCAN/cosine similarity queries to cluster identical faces.
- [ ] Build frontend UI to group photos by Person ID.
- [ ] **Test:** Upload photos of the same person across different ages/lighting and verify they cluster correctly.

## Phase 6: Sharing, Watermarking & Analytics
- [ ] Build API routes for creating share links with permissions (expiry, download limits).
- [ ] Implement dynamic watermarking using `sharp.composite()` on the fly for shared streams (bypassing disk write).
- [ ] Implement Redis buffered analytics (`HINCRBY`) and the 30-second cron job to flush to PostgreSQL.
- [ ] Build an Admin UI to monitor resource usage, set `scan_interval`, and adjust CPU limits (`worker.concurrency`).
- [ ] **Test:** Generate a shared link with watermarking, access it from an incognito window, and verify the stream contains the watermark and analytics are logged.
