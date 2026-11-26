import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { query } from '../src/config/db';
import { CaesiumService, DEFAULT_CAESIUM_CONFIG } from '../src/modules/gdrive/caesium.service';
import { GDriveService } from '../src/modules/gdrive/gdrive.service';

const execFileAsync = promisify(execFile);

async function runTests() {
  console.log('--- Starting Caesium & Google Drive Integration Tests ---');

  // Test 1: Caesium binary availability
  console.log('Test 1: Checking Caesium availability...');
  const status = await CaesiumService.isAvailable();
  console.log('Caesium availability:', status);
  if (!status.available) {
    throw new Error('Caesium CLI is not available!');
  }
  console.log('✓ Test 1 Passed: Caesium CLI is available and reporting version.');

  // Test 2: Compression test with sample image
  console.log('\nTest 2: Compressing a sample JPEG image...');
  const testDir = path.join(os.tmpdir(), `caesium_test_${Date.now()}`);
  await fs.promises.mkdir(testDir, { recursive: true });
  const sampleImagePath = path.join(testDir, 'sample_photo.jpg');

  // Generate a sample image using ffmpeg
  await execFileAsync('ffmpeg', [
    '-f', 'lavfi',
    '-i', 'testsrc=size=1920x1080:rate=1',
    '-frames:v', '1',
    sampleImagePath,
    '-y'
  ]);

  const initialStat = fs.statSync(sampleImagePath);
  console.log(`Original image generated: ${initialStat.size} bytes (${(initialStat.size / 1024).toFixed(1)} KB)`);

  // Compress with lossy mode, quality 70, max width 1280
  const compressRes = await CaesiumService.compressImage(sampleImagePath, {
    mode: 'lossy',
    quality: 70,
    width: 1280,
    keep_exif: true
  });

  console.log('Compression result:', {
    outputPath: compressRes.outputPath,
    originalSize: compressRes.originalSize,
    outputSize: compressRes.outputSize,
    savings: compressRes.savingsPercent
  });

  if (!fs.existsSync(compressRes.outputPath)) {
    throw new Error('Compressed output file does not exist!');
  }
  if (compressRes.outputSize >= compressRes.originalSize) {
    throw new Error('Expected compressed file to be smaller than original!');
  }

  // Cleanup test compression tempDir
  await CaesiumService.cleanupTempDir(compressRes.tempDir);
  console.log('✓ Test 2 Passed: Image successfully compressed with significant size reduction.');

  // Test 3: Default config (remembering & recycling parameters)
  console.log('\nTest 3: Testing saving and remembering default parameters...');
  const testConfig = {
    enabled: true,
    mode: 'lossy' as const,
    quality: 75,
    max_size: '750KB',
    width: 1920,
    height: 1080,
    keep_exif: true,
    keep_dates: true
  };

  const saved = await CaesiumService.saveDefaultConfig(testConfig);
  console.log('Saved default config:', saved);

  const retrieved = await CaesiumService.getDefaultConfig();
  console.log('Retrieved default config:', retrieved);

  if (retrieved.quality !== 75 || retrieved.width !== 1920 || retrieved.max_size !== '750KB') {
    throw new Error('Retrieved default config does not match saved config!');
  }
  console.log('✓ Test 3 Passed: Default parameters remembered in admin_settings.');

  // Test 4: Database folder_gdrive_syncs with Caesium parameters
  console.log('\nTest 4: Testing folder sync record creation and Caesium parameter recycling...');
  // Ensure dummy google account exists for testing
  await query(
    `INSERT INTO google_accounts (email, label, access_token, refresh_token)
     VALUES ('test_caesium@example.com', 'Test Account', 'mock_token', 'mock_refresh')
     ON CONFLICT DO NOTHING`
  );
  const accRes = await query(`SELECT id FROM google_accounts WHERE email = 'test_caesium@example.com' LIMIT 1`);
  const testAccountId = accRes.rows[0].id;

  // Mock GDriveService.createShareableFolder
  (GDriveService as any).createShareableFolder = async () => ({
    folderId: 'mock_folder_123',
    webViewLink: 'https://drive.google.com/test'
  });

  // Folder 1: Set sync config with custom Caesium parameters and saveAsDefault = true
  const folderPath1 = 'test/folder_events_2026';
  const sync1 = await GDriveService.setSyncConfig({
    accountId: testAccountId,
    sourceType: 'MEDIA',
    folderPath: folderPath1,
    folderName: 'Event 2026 Photos',
    caesiumEnabled: true,
    caesiumConfig: {
      enabled: true,
      mode: 'lossy',
      quality: 68,
      width: 1600,
      keep_exif: true
    },
    saveAsDefault: true
  });

  console.log('Folder 1 sync record created:', {
    id: sync1.id,
    folder_path: sync1.folder_path,
    caesium_enabled: sync1.caesium_enabled,
    caesium_config: sync1.caesium_config
  });

  if (!sync1.caesium_enabled || (sync1.caesium_config as any)?.quality !== 68) {
    throw new Error('Sync record 1 did not store Caesium config properly!');
  }

  // Verify that because saveAsDefault was true, remembered default was updated
  const rememberedAfterSync1 = await CaesiumService.getDefaultConfig();
  if (rememberedAfterSync1.quality !== 68 || rememberedAfterSync1.width !== 1600) {
    throw new Error('Default config was not updated from folder 1 saveAsDefault!');
  }
  console.log('✓ Remembered parameters successfully updated to quality: 68, width: 1600.');

  // Folder 2: Simulate recycling parameters on another folder without setting them!
  console.log('\nTest 5: Recycling remembered parameters on Folder 2 without setting them manually...');
  const folderPath2 = 'test/folder_vacation_2026';
  const recycledConfig = await CaesiumService.getDefaultConfig();

  const sync2 = await GDriveService.setSyncConfig({
    accountId: testAccountId,
    sourceType: 'MEDIA',
    folderPath: folderPath2,
    folderName: 'Vacation 2026 Photos',
    caesiumEnabled: recycledConfig.enabled,
    caesiumConfig: recycledConfig
  });

  console.log('Folder 2 sync record created with recycled config:', {
    id: sync2.id,
    folder_path: sync2.folder_path,
    caesium_enabled: sync2.caesium_enabled,
    caesium_config: sync2.caesium_config
  });

  if (!sync2.caesium_enabled || (sync2.caesium_config as any)?.quality !== 68) {
    throw new Error('Folder 2 did not correctly recycle the remembered parameters!');
  }
  console.log('✓ Test 5 Passed: Folder 2 successfully recycled remembered parameters without manual setting.');

  // Test 6: Updating parameters on an active folder sync
  console.log('\nTest 6: Testing updating Caesium parameters on an active sync...');
  const updatedSync1 = await GDriveService.updateCaesiumSyncConfig({
    folderPath: folderPath1,
    sourceType: 'MEDIA',
    caesiumEnabled: true,
    caesiumConfig: {
      enabled: true,
      mode: 'max_size',
      max_size: '500KB',
      keep_exif: true
    },
    saveAsDefault: false
  });

  console.log('Folder 1 updated Caesium config:', {
    caesium_enabled: updatedSync1.caesium_enabled,
    caesium_config: updatedSync1.caesium_config
  });

  if ((updatedSync1.caesium_config as any)?.mode !== 'max_size') {
    throw new Error('Folder 1 Caesium config was not updated!');
  }
  console.log('✓ Test 6 Passed: Successfully updated Caesium parameters on active folder sync.');

  // Cleanup test records
  await query(`DELETE FROM folder_gdrive_syncs WHERE folder_path IN ($1, $2)`, [folderPath1, folderPath2]);
  await query(`DELETE FROM google_accounts WHERE id = $1`, [testAccountId]);
  await fs.promises.rm(testDir, { recursive: true, force: true });

  console.log('\n==========================================================');
  console.log('🎉 ALL CAESIUM & GOOGLE DRIVE INTEGRATION TESTS PASSED! 🎉');
  console.log('==========================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
