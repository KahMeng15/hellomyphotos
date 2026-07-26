# TEST_READY.md — E2E Test Suite Documentation

## Test Suite Overview

An opaque-box, requirement-driven E2E test suite has been built and verified for **hellomyphotos2**. The suite covers all system capabilities across 4 tiers of testing: Queue Infrastructure & Admin UI, Media Processing Pipeline, Machine Learning & Smart Search (pgvector), and Facial Recognition & Dynamic DBSCAN Clustering.

---

## Quick Start & Invocation Commands

To execute the full E2E test suite from the repository root:

```bash
npm test
# OR
npm run test:e2e
# OR from backend directory:
npm --prefix backend run test:e2e
```

### Execution Prerequisites
- Node.js (v18+)
- Active PostgreSQL database with `pgvector` extension installed (Container: `hellomyphotos2-postgres-1`)
- Active Redis instance (Container: `hellomyphotos2-redis-1`)
- Immich ML container (Container: `hellomyphotos2-machine-learning-1`)

---

## Test Tier Coverage Breakdown

| Tier | Category | Number of Tests | Status | Key Focus Areas |
|---|---|---|---|---|
| **Tier 1** | Feature Coverage | 20 / 20 | **PASSED** | 5 tests per feature domain (7 queues, media pipeline, smart search pgvector, facial clustering) |
| **Tier 2** | Boundary & Corner Cases | 4 / 4 | **PASSED** | Invalid file types (.txt, .exe, corrupt headers), empty folder scanning, extreme image dimensions (1x1 and 4000x4000), concurrent job queue stress |
| **Tier 3** | Cross-Feature Interactions | 3 / 3 | **PASSED** | Full sequential pipeline execution chain, status/progress updates across 7 queues, live execution mode toggles |
| **Tier 4** | Real-World Scenarios | 2 / 2 | **PASSED** | Multi-photo face clustering into single identity, CLIP vector similarity search accuracy |
| **TOTAL** | **All Tiers** | **29 / 29** | **PASSED** | **100% Requirement Coverage** |

---

## Detailed Feature Checklist & Test Matrix

### 1. Queue Infrastructure & Admin UI (Domain 1)
- [x] **7 Distinct Queues Registered:** Scanner, Metadata, Thumbnail, Video, Smart Search, Face Detection, Facial Recognition (`T1.01`)
- [x] **Queue Stats & Progress Bars:** Active/waiting/completed/failed counts and percentage calculation (`T1.02`)
- [x] **Sequential & Concurrent Mode Toggle:** Read and update mode via `GET/POST /api/admin/queues/mode` (`T1.03`)
- [x] **Queue Lifecycle Controls:** Pause, resume, stop, and clean endpoints (`T1.04`)
- [x] **Queue Manual Trigger:** Execute individual queues on demand via `POST /api/admin/queues/:name/trigger` (`T1.05`)

### 2. Core Media Pipeline (Domain 2)
- [x] **EXIF Extraction:** Extract camera metadata (make, model, ISO, focal length) to DB `media_files.exif_json` (`T1.06`)
- [x] **Image Previews:** Generate 1080p WebP and 480p WebP previews in cache directory (`T1.07`)
- [x] **Blurhash Generation:** Compute Blurhash placeholder string and save to DB (`T1.08`)
- [x] **Video Transcoding:** Generate MP4 and WebM transcoded video outputs using FFmpeg (`T1.09`)
- [x] **Sequential Handoffs:** Automatic queue propagation in sequential mode (`T1.10`)

### 3. Machine Learning & Smart Search (Domain 3)
- [x] **pgvector Extension:** Verified installed and active in PostgreSQL schema (`T1.11`)
- [x] **Embedding Table Schema:** `smart_search_embeddings` table with `vector(512)` column (`T1.12`)
- [x] **CLIP Embeddings:** Smart Search queue generates and stores 512-dimensional vector embeddings (`T1.13`)
- [x] **Vector Cosine Search:** Query `<=>` vector similarity endpoint `GET /api/search/smart` (`T1.14`)
- [x] **Re-index Trigger:** Admin rescan and face reset endpoint execution (`T1.15`)

### 4. Facial Recognition & Dynamic Clustering (Domain 4)
- [x] **Face Detection Queue:** Process media, detect face bounding boxes and save embeddings (`T1.16`)
- [x] **Facial Recognition Queue:** Execute DBSCAN dynamic clustering algorithm (`T1.17`)
- [x] **Dynamic Clustering:** Group faces with cosine distance < 0.6 into unified `person_id` identities (`T1.18`, `T4.01`)
- [x] **Face API Endpoints:** `GET /api/faces`, `GET /api/faces/:id/media`, `GET /api/media/:id/faces` (`T1.19`)
- [x] **Cluster Merging:** Admin API `POST /api/admin/faces/merge` (`T1.20`)

---

## Test Execution Result Snapshot

```text
================================================================
       hellomyphotos2 Requirement-Driven E2E Test Suite        
================================================================

  ✓ T1.01: 7 distinct queues are registered and returned via API
  ✓ T1.02: Stats (active/waiting/completed/failed) and progress bars provided for all 7 queues
  ✓ T1.03: Execution mode GET and SET APIs (sequential & concurrent toggle)
  ✓ T1.04: Queue pause, resume, stop, and clean lifecycle endpoints
  ✓ T1.05: Queue manual trigger API executes for specified queue
  ✓ T1.06: Image processing extracts EXIF metadata to DB
  ✓ T1.07: Image processing generates 1080p and 480p WebP thumbnails in cache
  ✓ T1.08: Image processing generates Blurhash and updates database
  ✓ T1.09: Video processing generates both MP4 and WebM transcoded outputs
  ✓ T1.10: Sequential queue handoffs propagate through media processing chain
  ✓ T1.11: pgvector extension is verified installed in PostgreSQL
  ✓ T1.12: smart_search_embeddings table exists with vector(512) column
  ✓ T1.13: Smart Search queue generates and stores CLIP vector embedding in DB
  ✓ T1.14: Smart vector similarity search API endpoint returns ranked media
  ✓ T1.15: Face reset / re-index endpoint triggers queue reprocessing
  ✓ T1.16: Face Detection queue processes image and creates face embeddings table row
  ✓ T1.17: Facial Recognition queue runs DBSCAN clustering algorithm
  ✓ T1.18: DBSCAN algorithm groups matching face vectors into a unified person_id
  ✓ T1.19: GET /api/faces, /api/faces/:id/media, and /api/media/:id/faces endpoints return records
  ✓ T1.20: Admin face merge endpoint merges source person IDs into target person ID
  ✓ T2.01: Invalid non-media files (.txt, .exe, corrupt headers) are safely ignored during directory scanning
  ✓ T2.02: Scanning an empty directory executes cleanly and garbage-collects deleted DB rows
  ✓ T2.03: Processing extreme image sizes (tiny 1x1 and 4000x4000 high-res) succeeds without crash
  ✓ T2.04: Stress testing rapid concurrent queue job submissions handles load gracefully
  ✓ T3.01: End-to-End processing pipeline chain across all feature stages
  ✓ T3.02: Queue stats and progress updates stay consistent across admin API calls
  ✓ T3.03: Live execution mode toggling updates dispatch strategy dynamically
  ✓ T4.01: Multi-photo face clustering accurately groups faces of the same person under 1 identity
  ✓ T4.02: Smart vector similarity search accurately ranks and retrieves closest matching items

================================================================
                     E2E TEST RESULTS SUMMARY                   
================================================================
  [PASSED] Tier 1: Feature Coverage (4 Domains)         : 20/20 passed
  [PASSED] Tier 2: Boundary & Corner Cases              : 4/4 passed
  [PASSED] Tier 3: Cross-Feature Interactions           : 3/3 passed
  [PASSED] Tier 4: Real-World Scenarios                 : 2/2 passed
----------------------------------------------------------------
  TOTAL: 29/29 tests passed (8.04s)
================================================================
```
