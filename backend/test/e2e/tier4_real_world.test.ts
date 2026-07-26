import { ensureServerStarted, ensureTestAdminUser, createTestImage, cleanupTestData } from './helpers';
import { query } from '../../src/config/db';
import { MLService } from '../../src/modules/ml/ml.service';
import { ClusterService } from '../../src/modules/ml/cluster.service';

export async function runTier4Tests(): Promise<{ passed: number; failed: number; tests: { name: string; success: boolean; error?: string }[] }> {
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

  console.log('\n--- Running Tier 4: Real-World Scenarios Tests (2 Tests) ---');

  await test('T4.01: Multi-photo face clustering accurately groups faces of the same person under 1 identity', async () => {
    // Create 3 photos of Person A (close feature vectors) and 2 photos of Person B (distinct vectors)
    const personAVectorBase = new Array(512).fill(0.12);
    const personBVectorBase = new Array(512).fill(-0.25);

    const mediaIdsPersonA: string[] = [];
    const mediaIdsPersonB: string[] = [];

    for (let i = 0; i < 3; i++) {
      const filename = `person_a_${i}.jpg`;
      const imgPath = await createTestImage(filename);
      const mRes = await query(
        `INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_test_dir', $1, 'image/jpeg', 2000) RETURNING id`,
        [filename]
      );
      const mId = mRes.rows[0].id;
      mediaIdsPersonA.push(mId);

      // Slight variation in vector (distance < 0.6)
      const vec = personAVectorBase.map((val, idx) => val + (i * 0.002) * (idx % 2 === 0 ? 1 : -1));
      await query(
        `INSERT INTO face_embeddings (media_id, bounding_box, embedding) VALUES ($1, $2, $3::vector)`,
        [mId, JSON.stringify({ x: 10, y: 10, w: 60, h: 60 }), `[${vec.join(',')}]`]
      );
    }

    for (let j = 0; j < 2; j++) {
      const filename = `person_b_${j}.jpg`;
      const imgPath = await createTestImage(filename);
      const mRes = await query(
        `INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_test_dir', $1, 'image/jpeg', 2000) RETURNING id`,
        [filename]
      );
      const mId = mRes.rows[0].id;
      mediaIdsPersonB.push(mId);

      const vec = personBVectorBase.map((val, idx) => val + (j * 0.002) * (idx % 2 === 0 ? 1 : -1));
      await query(
        `INSERT INTO face_embeddings (media_id, bounding_box, embedding) VALUES ($1, $2, $3::vector)`,
        [mId, JSON.stringify({ x: 15, y: 15, w: 55, h: 55 }), `[${vec.join(',')}]`]
      );
    }

    // Run DBSCAN face clustering
    await ClusterService.reclusterFaces();

    // Verify Person A photos all share the SAME person_id
    const checkA = await query(
      `SELECT DISTINCT person_id FROM face_embeddings WHERE media_id = ANY($1::uuid[])`,
      [mediaIdsPersonA]
    );
    if (checkA.rows.length !== 1) {
      throw new Error(`Person A photos were split into ${checkA.rows.length} clusters instead of 1 identity`);
    }

    // Verify Person B photos share a DIFFERENT person_id
    const checkB = await query(
      `SELECT DISTINCT person_id FROM face_embeddings WHERE media_id = ANY($1::uuid[])`,
      [mediaIdsPersonB]
    );
    if (checkB.rows.length !== 1) {
      throw new Error(`Person B photos were split into ${checkB.rows.length} clusters instead of 1 identity`);
    }

    if (checkA.rows[0].person_id === checkB.rows[0].person_id) {
      throw new Error('Person A and Person B were incorrectly merged into the same identity');
    }
  });

  await test('T4.02: Smart vector similarity search accurately ranks and retrieves closest matching items', async () => {
    const filename1 = 'sunset_beach.jpg';
    const filename2 = 'mountain_snow.jpg';

    const path1 = await createTestImage(filename1, 600, 400, { r: 250, g: 120, b: 30 });
    const path2 = await createTestImage(filename2, 600, 400, { r: 200, g: 220, b: 255 });

    const m1 = await query(
      `INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_test_dir', $1, 'image/jpeg', 3000) RETURNING id`,
      [filename1]
    );
    const m2 = await query(
      `INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_test_dir', $1, 'image/jpeg', 3000) RETURNING id`,
      [filename2]
    );

    const mId1 = m1.rows[0].id;
    const mId2 = m2.rows[0].id;

    await MLService.generateClipEmbedding(mId1, path1);
    await MLService.generateClipEmbedding(mId2, path2);

    // Query smart search via vector similarity endpoint
    const res = await fetch(`${url}/api/search/smart?mediaId=${mId1}`, { headers });
    if (!res.ok) throw new Error(`Smart search query failed with status ${res.status}`);
    const resultsData = await res.json();

    if (!Array.isArray(resultsData) || resultsData.length === 0) {
      throw new Error('Smart search query returned empty results');
    }

    // Top match (distance 0 or lowest) should be the query image itself
    if (resultsData[0].media_id !== mId1) {
      throw new Error(`Expected top result to be ${mId1}, got ${resultsData[0].media_id}`);
    }
  });

  await cleanupTestData();

  return { passed, failed, tests: results };
}
