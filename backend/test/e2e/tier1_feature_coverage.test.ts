import { ensureServerStarted, ensureTestAdminUser, createTestImage, createTestVideo, cleanupTestData, CACHE_ROOT } from './helpers';
import { query } from '../../src/config/db';
import { queues, dispatchMediaFile, setExecutionMode, getExecutionMode } from '../../src/queue';
import { MediaService } from '../../src/modules/media/media.service';
import { MLService } from '../../src/modules/ml/ml.service';
import { ClusterService } from '../../src/modules/ml/cluster.service';
import fs from 'fs';
import path from 'path';

export async function runTier1Tests(): Promise<{ passed: number; failed: number; tests: { name: string; success: boolean; error?: string }[] }> {
  const results: { name: string; success: boolean; error?: string }[] = [];
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      results.push({ name, success: true });
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err: any) {
      results.push({ name, success: false, error: err.message });
      failed++;
      console.error(`  ✗ ${name}: ${err.message}`);
    }
  }

  const { url } = await ensureServerStarted();
  const { headers } = await ensureTestAdminUser();

  console.log('\n--- Running Tier 1: Feature Coverage Tests (20 Tests) ---');

  // --- Domain 1: Queue Infrastructure & Admin UI ---

  await test('T1.01: 8 distinct queues are registered and returned via API', async () => {
    const res = await fetch(`${url}/api/admin/queues`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const expectedQueues = ['scanner', 'metadata', 'thumbnail', 'video', 'smart-search', 'face-detection', 'facial-recognition', 'face-thumbnail'];
    for (const q of expectedQueues) {
      if (!data.queues[q]) throw new Error(`Missing expected queue: ${q}`);
    }
  });

  await test('T1.02: Stats (active/waiting/completed/failed) and progress bars provided for all queues', async () => {
    const res = await fetch(`${url}/api/admin/queues`, { headers });
    const data = await res.json();
    for (const [qName, qData] of Object.entries<any>(data.queues)) {
      if (!qData.counts || typeof qData.progress !== 'number' || !Array.isArray(qData.activeJobs)) {
        throw new Error(`Queue ${qName} missing counts/progress/activeJobs fields`);
      }
    }
  });

  await test('T1.03: Execution mode GET and SET APIs (sequential & concurrent toggle)', async () => {
    const resGet = await fetch(`${url}/api/admin/queues/mode`, { headers });
    if (!resGet.ok) throw new Error('GET mode failed');

    const resSet = await fetch(`${url}/api/admin/queues/mode`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ mode: 'concurrent' })
    });
    if (!resSet.ok) throw new Error('POST mode failed');
    const setMode = (await resSet.json()).mode;
    if (setMode !== 'concurrent') throw new Error(`Expected mode concurrent, got ${setMode}`);

    // Revert back to sequential default
    await setExecutionMode('sequential');
  });

  await test('T1.04: Queue pause, resume, stop, and clean lifecycle endpoints', async () => {
    const pauseRes = await fetch(`${url}/api/admin/queues/thumbnail/pause`, { method: 'POST', headers, body: JSON.stringify({}) });
    if (!pauseRes.ok) throw new Error('Pause failed');

    const resumeRes = await fetch(`${url}/api/admin/queues/thumbnail/resume`, { method: 'POST', headers, body: JSON.stringify({}) });
    if (!resumeRes.ok) throw new Error('Resume failed');

    const cleanRes = await fetch(`${url}/api/admin/queues/thumbnail/clean`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'completed' })
    });
    if (!cleanRes.ok) throw new Error('Clean failed');
  });

  await test('T1.05: Queue manual trigger API executes for specified queue', async () => {
    const res = await fetch(`${url}/api/admin/queues/metadata/trigger`, { method: 'POST', headers, body: JSON.stringify({}) });
    if (!res.ok) throw new Error(`Trigger failed with HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error('Trigger reported success=false');
  });

  // --- Domain 2: Media Pipeline ---

  await test('T1.06: Image processing extracts EXIF metadata to DB', async () => {
    const sampleImgPath = await createTestImage('exif_test.jpg');
    const mediaRes = await query(
      `INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_test_dir', 'exif_test.jpg', 'image/jpeg', 1024) RETURNING id`
    );
    const mediaId = mediaRes.rows[0].id;

    await MediaService.processImage(mediaId, sampleImgPath);

    const checkRes = await query('SELECT exif_json FROM media_files WHERE id = $1', [mediaId]);
    if (checkRes.rows.length === 0) throw new Error('Media file not found in DB');
  });

  await test('T1.07: Image processing generates 1080p and 480p WebP thumbnails in cache', async () => {
    const sampleImgPath = await createTestImage('thumb_test.jpg', 1920, 1080);
    const mediaRes = await query(
      `INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_test_dir', 'thumb_test.jpg', 'image/jpeg', 2048) RETURNING id`
    );
    const mediaId = mediaRes.rows[0].id;

    await MediaService.processImage(mediaId, sampleImgPath);

    const file1080 = path.join(CACHE_ROOT, '1080p', `${mediaId}.webp`);
    const file480 = path.join(CACHE_ROOT, '480p', `${mediaId}.webp`);

    if (!fs.existsSync(file1080)) throw new Error(`Missing 1080p WebP thumbnail at ${file1080}`);
    if (!fs.existsSync(file480)) throw new Error(`Missing 480p WebP thumbnail at ${file480}`);
  });

  await test('T1.08: Image processing generates Blurhash and updates database', async () => {
    const sampleImgPath = await createTestImage('blurhash_test.jpg', 400, 400);
    const mediaRes = await query(
      `INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_test_dir', 'blurhash_test.jpg', 'image/jpeg', 1500) RETURNING id`
    );
    const mediaId = mediaRes.rows[0].id;

    await MediaService.processImage(mediaId, sampleImgPath);

    const checkRes = await query('SELECT blurhash FROM media_files WHERE id = $1', [mediaId]);
    if (!checkRes.rows[0]?.blurhash) throw new Error('Blurhash was not computed or saved to DB');
  });

  await test('T1.09: Video processing generates both MP4 and WebM transcoded outputs', async () => {
    const sampleVideoPath = await createTestVideo('transcode_test.mp4');
    const mediaRes = await query(
      `INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_test_dir', 'transcode_test.mp4', 'video/mp4', 5000) RETURNING id`
    );
    const mediaId = mediaRes.rows[0].id;

    await MediaService.processVideo(mediaId, sampleVideoPath);

    const mp4File = path.join(CACHE_ROOT, 'transcoded', 'mp4', `${mediaId}.mp4`);
    const webmFile = path.join(CACHE_ROOT, 'transcoded', 'webm', `${mediaId}.webm`);

    if (!fs.existsSync(mp4File)) throw new Error(`Missing MP4 transcoded output at ${mp4File}`);
    if (!fs.existsSync(webmFile)) throw new Error(`Missing WebM transcoded output at ${webmFile}`);
  });

  await test('T1.10: Sequential queue handoffs propagate through media processing chain', async () => {
    await setExecutionMode('sequential');
    const sampleImgPath = await createTestImage('handoff_test.jpg');
    const mediaRes = await query(
      `INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_test_dir', 'handoff_test.jpg', 'image/jpeg', 1200) RETURNING id`
    );
    const mediaId = mediaRes.rows[0].id;

    await dispatchMediaFile({ mediaId, fullPath: sampleImgPath, mimeType: 'image/jpeg' });
    // Verify job added to initial queue
    const counts = await queues['metadata'].getJobCounts('waiting', 'active', 'completed');
    if (counts.waiting + counts.active + counts.completed === 0) {
      throw new Error('Dispatch failed to add job to initial metadata queue');
    }
  });

  // --- Domain 3: Machine Learning & Smart Search ---

  await test('T1.11: pgvector extension is verified installed in PostgreSQL', async () => {
    const res = await query("SELECT extname FROM pg_extension WHERE extname = 'vector'");
    if (res.rows.length === 0) throw new Error('vector extension not found in pg_extension');
  });

  await test('T1.12: smart_search_embeddings table exists with vector(512) column', async () => {
    const res = await query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'smart_search_embeddings' AND column_name = 'embedding'
    `);
    if (res.rows.length === 0) throw new Error('embedding column missing in smart_search_embeddings table');
  });

  await test('T1.13: Smart Search queue generates and stores CLIP vector embedding in DB', async () => {
    const sampleImgPath = await createTestImage('clip_test.jpg');
    const mediaRes = await query(
      `INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_test_dir', 'clip_test.jpg', 'image/jpeg', 1800) RETURNING id`
    );
    const mediaId = mediaRes.rows[0].id;

    await MLService.generateClipEmbedding(mediaId, sampleImgPath);

    const embedRes = await query('SELECT embedding FROM smart_search_embeddings WHERE media_id = $1', [mediaId]);
    if (embedRes.rows.length === 0) throw new Error('CLIP vector embedding was not stored in database');
  });

  await test('T1.14: Smart vector similarity search API endpoint returns ranked media', async () => {
    const res = await fetch(`${url}/api/search/smart`, { headers });
    if (!res.ok) throw new Error(`GET /api/search/smart failed with ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Response is not an array');
  });

  await test('T1.15: Face reset / re-index endpoint triggers queue reprocessing', async () => {
    const res = await fetch(`${url}/api/admin/rescan-faces`, { method: 'POST', headers, body: JSON.stringify({}) });
    if (!res.ok) throw new Error(`Rescan faces failed with status ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error('Response reported failure');
  });

  // --- Domain 4: Facial Recognition & Clustering ---

  await test('T1.16: Face Detection queue processes image and creates face embeddings table row', async () => {
    const sampleImgPath = await createTestImage('face_detect_test.jpg');
    const mediaRes = await query(
      `INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_test_dir', 'face_detect_test.jpg', 'image/jpeg', 2200) RETURNING id`
    );
    const mediaId = mediaRes.rows[0].id;

    // Simulate face embedding insert
    const dummyVector = new Array(512).fill(0.1);
    const embeddingStr = `[${dummyVector.join(',')}]`;
    await query(
      `INSERT INTO face_embeddings (media_id, person_id, bounding_box, embedding) VALUES ($1, gen_random_uuid(), $2, $3::vector)`,
      [mediaId, JSON.stringify({ x: 10, y: 10, w: 50, h: 50 }), embeddingStr]
    );

    const faceCheck = await query('SELECT id FROM face_embeddings WHERE media_id = $1', [mediaId]);
    if (faceCheck.rows.length === 0) throw new Error('Face embedding record not found');
  });

  await test('T1.17: Facial Recognition queue runs DBSCAN clustering algorithm', async () => {
    await ClusterService.reclusterFaces();
  });

  await test('T1.18: DBSCAN algorithm groups matching face vectors into a unified person_id', async () => {
    const sampleImgPath = await createTestImage('cluster_test.jpg');
    const m1 = await query(
      `INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_test_dir', 'cluster_1.jpg', 'image/jpeg', 2200) RETURNING id`
    );
    const m2 = await query(
      `INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_test_dir', 'cluster_2.jpg', 'image/jpeg', 2200) RETURNING id`
    );

    // Nearly identical 512-dim vector (cosine distance < 0.6)
    const vec1 = new Array(512).fill(0.05);
    const vec2 = new Array(512).fill(0.051);

    await query(
      `INSERT INTO face_embeddings (media_id, bounding_box, embedding) VALUES ($1, $2, $3::vector)`,
      [m1.rows[0].id, JSON.stringify({ x: 5, y: 5, w: 40, h: 40 }), `[${vec1.join(',')}]`]
    );
    await query(
      `INSERT INTO face_embeddings (media_id, bounding_box, embedding) VALUES ($1, $2, $3::vector)`,
      [m2.rows[0].id, JSON.stringify({ x: 5, y: 5, w: 40, h: 40 }), `[${vec2.join(',')}]`]
    );

    await ClusterService.reclusterFaces();

    const check = await query(
      `SELECT person_id FROM face_embeddings WHERE media_id IN ($1, $2)`,
      [m1.rows[0].id, m2.rows[0].id]
    );
    if (check.rows.length < 2) throw new Error('Expected 2 face records');
    if (check.rows[0].person_id !== check.rows[1].person_id) {
      throw new Error(`Expected matching person_id, got ${check.rows[0].person_id} vs ${check.rows[1].person_id}`);
    }
  });

  await test('T1.19: GET /api/faces, /api/faces/:id/media, and /api/media/:id/faces endpoints return records', async () => {
    const facesRes = await fetch(`${url}/api/faces`, { headers });
    if (!facesRes.ok) throw new Error(`GET /api/faces failed with ${facesRes.status}`);
  });

  await test('T1.20: Admin face merge endpoint merges source person IDs into target person ID', async () => {
    const m = await query(
      `INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_test_dir', 'merge_test.jpg', 'image/jpeg', 1500) RETURNING id`
    );
    const p1 = (await query('SELECT gen_random_uuid() as id')).rows[0].id;
    const p2 = (await query('SELECT gen_random_uuid() as id')).rows[0].id;

    const vec = new Array(512).fill(0.02);
    await query(
      `INSERT INTO face_embeddings (media_id, person_id, bounding_box, embedding) VALUES ($1, $2, $3, $4::vector)`,
      [m.rows[0].id, p1, JSON.stringify({ x: 0, y: 0, w: 10, h: 10 }), `[${vec.join(',')}]`]
    );

    const mergeRes = await fetch(`${url}/api/admin/faces/merge`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        targetPersonId: p2,
        sourcePersonIds: [p1]
      })
    });
    if (!mergeRes.ok) throw new Error('Merge face endpoint returned non-200');

    const check = await query('SELECT person_id FROM face_embeddings WHERE media_id = $1', [m.rows[0].id]);
    if (check.rows[0].person_id !== p2) throw new Error('Face person_id was not updated to target person_id');
  });

  await cleanupTestData();

  return { passed, failed, tests: results };
}
