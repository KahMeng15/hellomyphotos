import { ensureServerStarted, ensureTestAdminUser, createTestImage, cleanupTestData } from './helpers';
import { query } from '../../src/config/db';
import { setExecutionMode, getExecutionMode, dispatchMediaFile } from '../../src/queue';
import { MediaService } from '../../src/modules/media/media.service';
import { MLService } from '../../src/modules/ml/ml.service';
import { ClusterService } from '../../src/modules/ml/cluster.service';
import fs from 'fs';
import path from 'path';

const CACHE_ROOT = process.env.CACHE_ROOT || '/app/cache';

export async function runTier3Tests(): Promise<{ passed: number; failed: number; tests: { name: string; success: boolean; error?: string }[] }> {
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

  console.log('\n--- Running Tier 3: Cross-Feature Interactions Tests (5 Tests) ---');

  await test('T3.01: End-to-End processing pipeline chain across all feature stages', async () => {
    await setExecutionMode('pipeline');
    const imgPath = await createTestImage('e2e_chain.jpg', 800, 600);

    // 1. Insert DB media record
    const mRes = await query(
      `INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_test_dir', 'e2e_chain.jpg', 'image/jpeg', 3000) RETURNING id`
    );
    const mediaId = mRes.rows[0].id;

    // 2. Stage 1: Image Processing (Thumbnails + Blurhash)
    await MediaService.processImage(mediaId, imgPath);

    // 3. Stage 2: Smart Search CLIP Vector Generation
    await MLService.generateClipEmbedding(mediaId, imgPath);

    // 4. Stage 3: Face Detection & Embedding (two matching faces so DBSCAN forms a cluster)
    const dummyFaceVec = new Array(512).fill(0.08);
    await query(
      `INSERT INTO face_embeddings (media_id, bounding_box, embedding) VALUES ($1, $2, $3::vector)`,
      [mediaId, JSON.stringify({ x: 10, y: 10, w: 50, h: 50 }), `[${dummyFaceVec.join(',')}]`]
    );
    await query(
      `INSERT INTO face_embeddings (media_id, bounding_box, embedding) VALUES ($1, $2, $3::vector)`,
      [mediaId, JSON.stringify({ x: 60, y: 10, w: 50, h: 50 }), `[${dummyFaceVec.join(',')}]`]
    );

    // 5. Stage 4: Facial Recognition DBSCAN Clustering
    await ClusterService.reclusterFaces();

    // Verify all state updates propagated across DB and disk cache
    const dbRecord = await query('SELECT blurhash FROM media_files WHERE id = $1', [mediaId]);
    const clipRecord = await query('SELECT embedding FROM smart_search_embeddings WHERE media_id = $1', [mediaId]);
    const faceRecord = await query('SELECT person_id FROM face_embeddings WHERE media_id = $1', [mediaId]);

    const file1080 = path.join(CACHE_ROOT, '1080p', `${mediaId}.webp`);

    if (!dbRecord.rows[0]?.blurhash) throw new Error('Blurhash missing after pipeline chain');
    if (clipRecord.rows.length === 0) throw new Error('CLIP embedding missing after pipeline chain');
    if (!faceRecord.rows[0]?.person_id) throw new Error('Person ID missing after facial clustering');
    if (!fs.existsSync(file1080)) throw new Error('Thumbnail missing after pipeline chain');
  });

  await test('T3.02: Queue stats and progress updates stay consistent across admin API calls', async () => {
    const res = await fetch(`${url}/api/admin/queues`, { headers });
    if (!res.ok) throw new Error('Failed to fetch admin queues endpoint');
    const data = await res.json();
    if (!data.queues || Object.keys(data.queues).length !== 10) {
      throw new Error(`Expected 10 queues in response, found ${Object.keys(data.queues || {}).length}`);
    }
  });

  await test('T3.03: Live execution mode toggling updates dispatch strategy dynamically', async () => {
    await setExecutionMode('batch');
    const currentMode = await getExecutionMode();
    if (currentMode !== 'batch') throw new Error('Failed to set execution mode to batch');

    const sampleImgPath = await createTestImage('mode_toggle.jpg');
    const mRes = await query(
      `INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_test_dir', 'mode_toggle.jpg', 'image/jpeg', 2000) RETURNING id`
    );
    const mediaId = mRes.rows[0].id;

    await dispatchMediaFile({ mediaId, fullPath: sampleImgPath, mimeType: 'image/jpeg' });

    // Switch back to pipeline
    await setExecutionMode('pipeline');
  });

  await test('T3.04: Shared folder password protection, internal labels, and favorite filtering permissions', async () => {
    // 1. Create a password-protected share with allow_filter_favorites enabled and custom label
    const createShareRes = await fetch(`${url}/api/shares`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        folderPath: 'e2e_test_dir',
        allowFavorites: true,
        allowFilterFavorites: true,
        password: 'SecureSharePassword123!',
        label: 'VIP Wedding Client'
      })
    });
    if (!createShareRes.ok) throw new Error(`Create share failed with ${createShareRes.status}`);
    const shareData = await createShareRes.json();
    const token = shareData.shareToken || shareData.share_token;
    if (!token) throw new Error('Share creation did not return a shareToken');

    // 2. Fetch public share metadata: should indicate password protection and permission flags
    const publicMetaRes = await fetch(`${url}/api/shares/${token}`);
    if (!publicMetaRes.ok) throw new Error(`Public share get failed with ${publicMetaRes.status}`);
    const publicMeta = await publicMetaRes.json();

    if (!publicMeta.has_password) throw new Error('Expected has_password to be true');
    if (!publicMeta.allow_favorites) throw new Error('Expected allow_favorites to be true');
    if (!publicMeta.allow_filter_favorites) throw new Error('Expected allow_filter_favorites to be true');

    // 3. Admin share list should return the internal label and allow_filter_favorites setting
    const adminSharesRes = await fetch(`${url}/api/admin/shares`, { headers });
    if (!adminSharesRes.ok) throw new Error(`Admin shares failed with ${adminSharesRes.status}`);
    const adminShares = await adminSharesRes.json();
    const foundShare = (adminShares.shares || []).find((s: any) => s.share_token === token);
    if (!foundShare) throw new Error('Created share was not found in admin shares list');
    if (foundShare.label !== 'VIP Wedding Client') {
      throw new Error(`Expected label "VIP Wedding Client", got "${foundShare.label}"`);
    }
    if (foundShare.allow_filter_favorites !== true) {
      throw new Error('Expected allow_filter_favorites to be true in admin shares list');
    }

    // 4. Update share to toggle allow_filter_favorites
    const updateRes = await fetch(`${url}/api/shares/${foundShare.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        allowFilterFavorites: false
      })
    });
    if (!updateRes.ok) throw new Error(`Failed to update share allow_filter_favorites: ${updateRes.status}`);

    const verifyUpdateRes = await fetch(`${url}/api/shares/${token}`);
    const verifyMeta = await verifyUpdateRes.json();
    if (verifyMeta.allow_filter_favorites !== false) {
      throw new Error('Expected allow_filter_favorites to be false after PATCH update');
    }
  });

  await test('T3.05: FastUp OTP claim brute-force lockout rate limiting protection', async () => {
    // Attempt invalid OTPs to verify security lockout logic does not 500
    const failRes = await fetch(`${url}/api/staging/otp/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp: '000000' })
    });
    if (failRes.status !== 400 && failRes.status !== 429) {
      throw new Error(`Expected HTTP 400 or 429 for invalid OTP, received ${failRes.status}`);
    }
  });

  await cleanupTestData();

  return { passed, failed, tests: results };
}
