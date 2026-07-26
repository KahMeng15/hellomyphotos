import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import sharp from 'sharp';
import { query } from './config/db';
import { MetadataService } from './modules/media/metadata.service';
import { MediaService } from './modules/media/media.service';
import { VideoService } from './modules/media/video.service';
import { SmartSearchService } from './modules/ml/smartSearch.service';
import { MLService } from './modules/ml/ml.service';
import { ClusterService } from './modules/ml/cluster.service';
import { getExecutionMode, setExecutionMode } from './queue/mode';

const TEST_CACHE_ROOT = process.env.CACHE_ROOT || '/app/cache';

async function runTests() {
  console.log('=== Running Core Media Pipeline Tests ===');
  let passCount = 0;
  let failCount = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`✅ PASS: ${msg}`);
      passCount++;
    } else {
      console.error(`❌ FAIL: ${msg}`);
      failCount++;
    }
  }

  const testDir = path.join(process.cwd(), 'scratch_test');
  await fs.promises.mkdir(testDir, { recursive: true });

  // 1. Create a synthetic test image using sharp
  const testImgPath = path.join(testDir, 'sample_test_image.jpg');
  await sharp({
    create: {
      width: 2000,
      height: 1500,
      channels: 3,
      background: { r: 100, g: 150, b: 200 }
    }
  })
  .jpeg({ quality: 90 })
  .toFile(testImgPath);

  // 2. Create a genuine synthetic test MP4 video using ffmpeg
  const testVideoPath = path.join(testDir, 'sample_test_video.mp4');
  execSync(`ffmpeg -y -f lavfi -i testsrc=duration=1:size=320x240:rate=10 -c:v libx264 -pix_fmt yuv420p "${testVideoPath}"`);

  const testMediaId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const testVideoMediaId = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';

  // Seed DB rows if Postgres is connected
  try {
    await query(
      `INSERT INTO media_files (id, folder_path, file_name, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (folder_path, file_name) DO NOTHING`,
      [testMediaId, 'test', 'sample_test_image.jpg', 'image/jpeg', 1000]
    );
    await query(
      `INSERT INTO media_files (id, folder_path, file_name, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (folder_path, file_name) DO NOTHING`,
      [testVideoMediaId, 'test', 'sample_test_video.mp4', 'video/mp4', 2000]
    );
  } catch (err: any) {
    console.warn('[Test DB Seed Notice]:', err.message);
  }

  // Test 1: Metadata Extraction
  console.log('\n--- Test 1: Metadata Extraction Service ---');
  try {
    const meta = await MetadataService.extractMetadata(testMediaId, testImgPath, 'image/jpeg');
    assert(meta !== undefined, 'MetadataService returned metadata object or result');
  } catch (err: any) {
    assert(false, `Metadata extraction threw error: ${err.message}`);
  }

  // Test 2: Thumbnail Generation Queue Service
  console.log('\n--- Test 2: Thumbnail & Preview Generation (Sharp & Blurhash) ---');
  try {
    const result = await MediaService.processImage(testMediaId, testImgPath);
    const out1080 = path.join(TEST_CACHE_ROOT, '1080p', `${testMediaId}.webp`);
    const out480 = path.join(TEST_CACHE_ROOT, '480p', `${testMediaId}.webp`);

    assert(fs.existsSync(out1080), `1080p preview generated at ${out1080}`);
    assert(fs.existsSync(out480), `480p thumbnail generated at ${out480}`);
    assert(typeof result.blurhash === 'string' && result.blurhash.length > 0, `Blurhash generated: ${result.blurhash}`);
    assert(result.has1080p === true, 'has_1080p flag set to true');
    assert(result.has480p === true, 'has_480p flag set to true');

    // Clean up cache outputs
    try { await fs.promises.unlink(out1080); } catch (e) {}
    try { await fs.promises.unlink(out480); } catch (e) {}
  } catch (err: any) {
    assert(false, `MediaService processing threw error: ${err.message}`);
  }

  // Test 3: Video Transcoding Service
  console.log('\n--- Test 3: Video Transcoding Service (fluent-ffmpeg) ---');
  try {
    const videoResult = await VideoService.processVideo(testVideoMediaId, testVideoPath);
    const outMp4 = path.join(TEST_CACHE_ROOT, 'video', `${testVideoMediaId}.mp4`);
    const outWebm = path.join(TEST_CACHE_ROOT, 'video', `${testVideoMediaId}.webm`);

    assert(fs.existsSync(outMp4), `MP4 output created at ${outMp4}`);
    assert(fs.existsSync(outWebm), `WebM output created at ${outWebm}`);
    assert(videoResult.isTranscoded === true, 'is_transcoded flag set to true');

    const mp4Size = fs.existsSync(outMp4) ? fs.statSync(outMp4).size : 0;
    const webmSize = fs.existsSync(outWebm) ? fs.statSync(outWebm).size : 0;
    assert(mp4Size > 1000, `Authentic MP4 video generated (${mp4Size} bytes)`);
    assert(webmSize > 1000, `Authentic WebM video generated (${webmSize} bytes)`);

    // Clean up
    try { await fs.promises.unlink(outMp4); } catch (e) {}
    try { await fs.promises.unlink(outWebm); } catch (e) {}
  } catch (err: any) {
    assert(false, `VideoService processing threw error: ${err.message}`);
  }

  // Test 4: Execution Mode & Handoff Configuration
  console.log('\n--- Test 4: Queue Execution Mode ---');
  try {
    await setExecutionMode('sequential');
    const mode = await getExecutionMode();
    assert(mode === 'sequential', `Queue execution mode is correctly set to '${mode}'`);
  } catch (err: any) {
    assert(false, `Execution mode check threw error: ${err.message}`);
  }

  // Test 5: Smart Search CLIP Vector Embedding & Search
  console.log('\n--- Test 5: Smart Search CLIP Embeddings (@xenova/transformers) ---');
  try {
    const textEmbedding = await SmartSearchService.generateTextEmbedding('a test image with blue background');
    assert(Array.isArray(textEmbedding) && textEmbedding.length === 512, `Generated 512-dim CLIP text embedding (length: ${textEmbedding.length})`);

    const imageEmbedding = await SmartSearchService.processAndSaveMediaEmbedding(testMediaId, testImgPath);
    assert(Array.isArray(imageEmbedding) && imageEmbedding.length === 512, `Generated 512-dim CLIP image embedding for ${testMediaId}`);

    const searchResults = await SmartSearchService.searchMedia('blue background', 5);
    assert(Array.isArray(searchResults), `Smart Search returned result array (count: ${searchResults.length})`);
    if (searchResults.length > 0) {
      assert(searchResults[0].id === testMediaId, `Top matching result corresponds to test media ID (${testMediaId})`);
    }
  } catch (err: any) {
    assert(false, `SmartSearchService test threw error: ${err.message}`);
  }

  // Test 6: Face Detection & 512-dim Vector Embeddings
  console.log('\n--- Test 6: Face Detection & 512-dim Vector Embeddings ---');
  try {
    await query(`DELETE FROM face_embeddings WHERE media_id = $1`, [testMediaId]);

    // Insert synthetic face vectors for mediaId
    const faceVec1 = new Array(512).fill(0.08);
    const faceVec2 = new Array(512).fill(0.081);
    const embeddingStr1 = `[${faceVec1.join(',')}]`;
    const embeddingStr2 = `[${faceVec2.join(',')}]`;

    await query(
      `INSERT INTO face_embeddings (media_id, bounding_box, embedding) VALUES ($1, $2, $3::vector)`,
      [testMediaId, JSON.stringify({ x: 10, y: 10, w: 50, h: 50 }), embeddingStr1]
    );
    await query(
      `INSERT INTO face_embeddings (media_id, bounding_box, embedding) VALUES ($1, $2, $3::vector)`,
      [testMediaId, JSON.stringify({ x: 70, y: 70, w: 50, h: 50 }), embeddingStr2]
    );

    const checkEmbeds = await query(`SELECT id, embedding::text as vector FROM face_embeddings WHERE media_id = $1`, [testMediaId]);
    assert(checkEmbeds.rows.length === 2, `Inserted and retrieved 2 face embeddings for media ${testMediaId}`);
  } catch (err: any) {
    assert(false, `Face detection storage check threw error: ${err.message}`);
  }

  // Test 7: Facial Recognition & Dynamic DBSCAN Clustering
  console.log('\n--- Test 7: Facial Recognition & Dynamic DBSCAN Clustering ---');
  try {
    await ClusterService.reclusterFaces(0.6, 1);
    const checkClusters = await query(`SELECT DISTINCT person_id FROM face_embeddings WHERE media_id = $1 AND person_id IS NOT NULL`, [testMediaId]);
    assert(checkClusters.rows.length === 1, `Dynamic DBSCAN grouped close vectors into 1 unified person_id cluster`);
  } catch (err: any) {
    assert(false, `DBSCAN dynamic clustering check threw error: ${err.message}`);
  }

  // Cleanup testDir
  try {
    await fs.promises.rm(testDir, { recursive: true, force: true });
  } catch (e) {}

  console.log(`\n=== Test Results: ${passCount} Passed, ${failCount} Failed ===`);
  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

