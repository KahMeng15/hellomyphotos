import { ensureServerStarted, ensureTestAdminUser, createTestImage, cleanupTestData } from './helpers';
import { query } from '../../src/config/db';
import { ScannerService } from '../../src/modules/scanner/scanner.service';
import { MediaService } from '../../src/modules/media/media.service';
import { queues } from '../../src/queue';
import fs from 'fs';
import path from 'path';

const MEDIA_ROOT = process.env.MEDIA_ROOT || '/app/media';

export async function runTier2Tests(): Promise<{ passed: number; failed: number; tests: { name: string; success: boolean; error?: string }[] }> {
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

  console.log('\n--- Running Tier 2: Boundary & Corner Cases Tests (4 Tests) ---');

  await test('T2.01: Invalid non-media files (.txt, .exe, corrupt headers) are safely ignored during directory scanning', async () => {
    const boundaryDir = path.join(MEDIA_ROOT, 'e2e_boundary_dir');
    fs.mkdirSync(boundaryDir, { recursive: true });

    fs.writeFileSync(path.join(boundaryDir, 'document.txt'), 'Plain text content');
    fs.writeFileSync(path.join(boundaryDir, 'executable.exe'), Buffer.from([0x4d, 0x5a, 0x90, 0x00]));
    fs.writeFileSync(path.join(boundaryDir, 'corrupt.jpg'), Buffer.from('NOT_A_REAL_JPEG_FILE'));

    await ScannerService.scanDirectory('e2e_boundary_dir');

    const txtCheck = await query("SELECT id FROM media_files WHERE folder_path = 'e2e_boundary_dir' AND file_name = 'document.txt'");
    const exeCheck = await query("SELECT id FROM media_files WHERE folder_path = 'e2e_boundary_dir' AND file_name = 'executable.exe'");

    if (txtCheck.rows.length > 0) throw new Error('Plain text file was incorrectly indexed into media_files');
    if (exeCheck.rows.length > 0) throw new Error('Executable file was incorrectly indexed into media_files');

    fs.rmSync(boundaryDir, { recursive: true, force: true });
    await query("DELETE FROM media_files WHERE folder_path = 'e2e_boundary_dir'");
  });

  await test('T2.02: Scanning an empty directory executes cleanly and garbage-collects deleted DB rows', async () => {
    const emptyDir = path.join(MEDIA_ROOT, 'e2e_empty_dir');
    fs.mkdirSync(emptyDir, { recursive: true });

    await query("INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_empty_dir', 'old.jpg', 'image/jpeg', 100)");

    await ScannerService.scanDirectory('e2e_empty_dir');

    const check = await query("SELECT id FROM media_files WHERE folder_path = 'e2e_empty_dir'");
    if (check.rows.length > 0) throw new Error('Garbage collection failed to prune missing files in empty directory');

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  await test('T2.03: Processing extreme image sizes (tiny 1x1 and 4000x4000 high-res) succeeds without crash', async () => {
    const tinyPath = await createTestImage('tiny_1x1.jpg', 1, 1);
    const hugePath = await createTestImage('huge_4000x4000.jpg', 4000, 4000);

    const mTiny = await query("INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_test_dir', 'tiny_1x1.jpg', 'image/jpeg', 100) RETURNING id");
    const mHuge = await query("INSERT INTO media_files (folder_path, file_name, mime_type, size_bytes) VALUES ('e2e_test_dir', 'huge_4000x4000.jpg', 'image/jpeg', 500000) RETURNING id");

    await MediaService.processImage(mTiny.rows[0].id, tinyPath);
    await MediaService.processImage(mHuge.rows[0].id, hugePath);

    const checkTiny = await query("SELECT blurhash FROM media_files WHERE id = $1", [mTiny.rows[0].id]);
    const checkHuge = await query("SELECT blurhash FROM media_files WHERE id = $1", [mHuge.rows[0].id]);

    if (!checkTiny.rows[0]?.blurhash) throw new Error('Tiny 1x1 image blurhash failed');
    if (!checkHuge.rows[0]?.blurhash) throw new Error('Huge 4000x4000 image blurhash failed');
  });

  await test('T2.04: Stress testing rapid concurrent queue job submissions handles load gracefully', async () => {
    const q = queues['metadata'];
    const jobPromises = [];
    for (let i = 0; i < 20; i++) {
      jobPromises.push(q.add('stress-job', { mediaId: `stress_${i}`, mimeType: 'image/jpeg', fullPath: '' }));
    }
    await Promise.all(jobPromises);
  });

  await cleanupTestData();

  return { passed, failed, tests: results };
}
