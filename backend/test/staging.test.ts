import assert from 'assert';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { sanitizeSessionId, getMimeType, isRawFile } from '../src/modules/staging/staging.service';
import { resolveMediaFullPath, STAGING_ROOT, MEDIA_ROOT } from '../src/utils/mediaPath';
import { app } from '../src/app';

async function runTests() {
  console.log('--- Testing Staging Utilities ---');

  // 1. Session ID sanitization & path traversal defense with nested subdirectories support
  assert.strictEqual(sanitizeSessionId('event-2026-11-21'), 'event-2026-11-21');
  assert.strictEqual(sanitizeSessionId('events/2026/john-wedding'), 'events/2026/john-wedding');
  assert.strictEqual(sanitizeSessionId('weddings/session1'), 'weddings/session1');
  assert.strictEqual(sanitizeSessionId('/events/2026/john-wedding/'), 'events/2026/john-wedding');
  assert.strictEqual(sanitizeSessionId('events//2026///john-wedding'), 'events/2026/john-wedding');
  assert.strictEqual(sanitizeSessionId('Event 2026 / Wedding'), 'Event_2026/Wedding');
  assert.strictEqual(sanitizeSessionId('../../../etc/passwd'), 'etc/passwd');
  assert.strictEqual(sanitizeSessionId('..\\..\\windows\\system32'), 'windows/system32');
  assert.strictEqual(sanitizeSessionId('normal_session.123'), 'normal_session.123');
  console.log('✓ sanitizeSessionId tests passed (including nested subdirectories)');

  // 2. MIME type & RAW detection
  assert.strictEqual(getMimeType('photo.jpg'), 'image/jpeg');
  assert.strictEqual(getMimeType('photo.jpeg'), 'image/jpeg');
  assert.strictEqual(getMimeType('photo.png'), 'image/png');
  assert.strictEqual(getMimeType('photo.webp'), 'image/webp');
  assert.strictEqual(getMimeType('photo.heic'), 'image/heic');
  assert.strictEqual(getMimeType('photo.CR2'), 'image/x-canon-cr2');
  assert.strictEqual(getMimeType('photo.cr3'), 'image/x-canon-cr3');
  assert.strictEqual(getMimeType('photo.NEF'), 'image/x-nikon-nef');
  assert.strictEqual(getMimeType('photo.arw'), 'image/x-sony-arw');
  assert.strictEqual(getMimeType('photo.DNG'), 'image/x-adobe-dng');
  assert.strictEqual(getMimeType('photo.raf'), 'image/x-fuji-raf');
  assert.strictEqual(getMimeType('photo.rw2'), 'image/x-panasonic-rw2');

  assert.strictEqual(isRawFile('IMG_0001.CR2'), true);
  assert.strictEqual(isRawFile('DSC0001.ARW'), true);
  assert.strictEqual(isRawFile('DSC_0001.NEF'), true);
  assert.strictEqual(isRawFile('photo.jpg'), false);
  assert.strictEqual(isRawFile('photo.png'), false);
  console.log('✓ MIME type & RAW detection tests passed');

  // 3. Media path resolution
  const stagingResolved = resolveMediaFullPath('staging/event-1', 'photo.jpg');
  assert.strictEqual(stagingResolved, path.join(STAGING_ROOT, 'event-1', 'photo.jpg'));

  const mediaResolved = resolveMediaFullPath('2024/School', 'pic.jpg');
  assert.strictEqual(mediaResolved, path.join(MEDIA_ROOT, '2024/School', 'pic.jpg'));
  console.log('✓ resolveMediaFullPath tests passed');

  // 4. Fastify route injection tests
  console.log('--- Testing Fastify Staging Routes ---');
  await app.ready();

  // Test 4a: Unauthorized requests are rejected
  const unauthUpload = await app.inject({
    method: 'POST',
    url: '/api/staging/upload'
  });
  assert.strictEqual(unauthUpload.statusCode, 401, 'Unauthenticated upload must be rejected with 401');

  const unauthSessions = await app.inject({
    method: 'GET',
    url: '/api/staging/sessions'
  });
  assert.strictEqual(unauthSessions.statusCode, 401, 'Unauthenticated sessions list must be rejected with 401');

  // Test 4b: API Key authentication bypass when STAGING_API_KEY is configured
  process.env.STAGING_API_KEY = 'test_secret_api_key_123';

  // Bad API key should still be 401
  const badKeyRes = await app.inject({
    method: 'GET',
    url: '/api/staging/sessions',
    headers: { 'x-api-key': 'wrong_key' }
  });
  assert.strictEqual(badKeyRes.statusCode, 401, 'Incorrect API key must be rejected');

  // Correct API key should succeed
  const goodKeyRes = await app.inject({
    method: 'GET',
    url: '/api/staging/sessions',
    headers: { 'x-api-key': 'test_secret_api_key_123' }
  });
  assert.strictEqual(goodKeyRes.statusCode, 200, 'Valid API key must return 200');
  const sessionsBody = JSON.parse(goodKeyRes.payload);
  assert.strictEqual(sessionsBody.success, true);
  assert(Array.isArray(sessionsBody.sessions));
  console.log('✓ API Key authentication tests passed');

  // Test 4b2: POST /api/staging/folders (Folder Creation)
  const nestedFolderPath = `weddings/2026/test_event_${Date.now()}`;
  const createFolderRes = await app.inject({
    method: 'POST',
    url: '/api/staging/folders',
    headers: {
      'x-api-key': 'test_secret_api_key_123',
      'content-type': 'application/json'
    },
    payload: JSON.stringify({ folderPath: nestedFolderPath })
  });
  assert.strictEqual(createFolderRes.statusCode, 200, `Create folder failed: ${createFolderRes.payload}`);
  const createFolderJson = JSON.parse(createFolderRes.payload);
  assert.strictEqual(createFolderJson.success, true);
  assert.strictEqual(createFolderJson.folderPath, nestedFolderPath);
  assert(fs.existsSync(path.join(STAGING_ROOT, nestedFolderPath)), 'Created folder must exist on disk');
  console.log('✓ POST /api/staging/folders successfully created nested directory');

  // Test 4b3: GET /api/staging/folders (Folder Listing)
  const listFoldersRes = await app.inject({
    method: 'GET',
    url: '/api/staging/folders',
    headers: { 'x-api-key': 'test_secret_api_key_123' }
  });
  assert.strictEqual(listFoldersRes.statusCode, 200);
  const listFoldersJson = JSON.parse(listFoldersRes.payload);
  assert.strictEqual(listFoldersJson.success, true);
  assert(Array.isArray(listFoldersJson.folders));
  assert(listFoldersJson.folders.includes(nestedFolderPath), `Folders list must include created folder: ${nestedFolderPath}`);
  console.log('✓ GET /api/staging/folders successfully returned recursive folder tree');

  // Test 4c: Multipart upload via app.inject
  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  const testSessionId = `test_session_${Date.now()}`;
  const dummyJpegContent = await sharp({
    create: { width: 200, height: 150, channels: 3, background: { r: 220, g: 100, b: 50 } }
  }).jpeg().toBuffer();

  const multipartPayload = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="sessionId"',
    '',
    testSessionId,
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="tethered_test_01.jpg"',
    'Content-Type: image/jpeg',
    '',
    dummyJpegContent.toString('binary'),
    `--${boundary}--`,
    ''
  ].join('\r\n');

  const uploadRes = await app.inject({
    method: 'POST',
    url: '/api/staging/upload',
    headers: {
      'x-api-key': 'test_secret_api_key_123',
      'content-type': `multipart/form-data; boundary=${boundary}`
    },
    payload: Buffer.from(multipartPayload, 'binary')
  });

  assert.strictEqual(uploadRes.statusCode, 200, `Upload response code: ${uploadRes.statusCode}, body: ${uploadRes.payload}`);
  const uploadJson = JSON.parse(uploadRes.payload);
  assert.strictEqual(uploadJson.success, true);
  assert.strictEqual(uploadJson.sessionId, testSessionId);
  assert.strictEqual(uploadJson.count, 1);
  assert.strictEqual(uploadJson.files[0].fileName, 'tethered_test_01.jpg');

  // Verify file was saved to disk
  const savedFilePath = path.join(STAGING_ROOT, testSessionId, 'tethered_test_01.jpg');
  assert(fs.existsSync(savedFilePath), `Uploaded file must exist at ${savedFilePath}`);
  console.log('✓ POST /api/staging/upload verified on disk and DB');

  // Test 4d: Create Share Link
  const shareRes = await app.inject({
    method: 'POST',
    url: '/api/staging/create-share',
    headers: {
      'x-api-key': 'test_secret_api_key_123',
      'content-type': 'application/json'
    },
    payload: JSON.stringify({
      sessionId: testSessionId,
      allowDownloadImages: true,
      allowDownloadFolder: true
    })
  });

  assert.strictEqual(shareRes.statusCode, 200, `Create share code: ${shareRes.statusCode}, body: ${shareRes.payload}`);
  const shareJson = JSON.parse(shareRes.payload);
  assert.strictEqual(shareJson.success, true);
  assert(typeof shareJson.shareToken === 'string' && shareJson.shareToken.length > 0);
  assert(shareJson.shareUrl.includes(shareJson.shareToken));
  console.log('✓ POST /api/staging/create-share generated valid share:', shareJson.shareUrl);

  // Test 4e: Verify guest access via public share API
  const guestShareRes = await app.inject({
    method: 'GET',
    url: `/api/shares/${shareJson.shareToken}`,
    cookies: { [`ts_${shareJson.shareToken}`]: 'verified' }
  });
  assert.strictEqual(guestShareRes.statusCode, 200, `Guest share returned ${guestShareRes.statusCode}`);
  const guestShareJson = JSON.parse(guestShareRes.payload);
  assert.strictEqual(guestShareJson.files.length, 1);
  assert.strictEqual(guestShareJson.files[0].file_name, 'tethered_test_01.jpg');
  console.log('✓ Guest access via /api/shares/:token confirmed, staging photos visible in gallery');

  // Verify guest thumbnail access
  const photoId = guestShareJson.files[0].id;
  const thumbRes = await app.inject({
    method: 'GET',
    url: `/api/media/${photoId}/thumbnail?shareToken=${shareJson.shareToken}`
  });
  assert.strictEqual(thumbRes.statusCode, 200, `Thumbnail returned ${thumbRes.statusCode}`);
  console.log('✓ Guest access to /api/media/:id/thumbnail confirmed');

  // Test 4f: Verify session details in GET /api/staging/:sessionId
  const sessionDetailRes = await app.inject({
    method: 'GET',
    url: `/api/staging/${testSessionId}`,
    headers: { 'x-api-key': 'test_secret_api_key_123' }
  });
  assert.strictEqual(sessionDetailRes.statusCode, 200);
  const detailJson = JSON.parse(sessionDetailRes.payload);
  assert.strictEqual(detailJson.sessionId, testSessionId);
  assert.strictEqual(detailJson.photoCount, 1);
  assert.strictEqual(detailJson.shares.length, 1);
  assert.strictEqual(detailJson.shares[0].shareToken, shareJson.shareToken);
  console.log('✓ GET /api/staging/:sessionId returned correct metadata');

  // Test 4f: Cleanup session via DELETE /api/staging/:sessionId
  const deleteRes = await app.inject({
    method: 'DELETE',
    url: `/api/staging/${testSessionId}`,
    headers: { 'x-api-key': 'test_secret_api_key_123' }
  });
  assert.strictEqual(deleteRes.statusCode, 200);
  const deleteJson = JSON.parse(deleteRes.payload);
  assert.strictEqual(deleteJson.success, true);
  assert.strictEqual(deleteJson.deletedPhotosCount, 1);

  // Verify file was purged from disk
  assert(!fs.existsSync(savedFilePath), 'Cleaned up file must be purged from disk');
  assert(!fs.existsSync(path.join(STAGING_ROOT, testSessionId)), 'Session folder must be purged from disk');
  console.log('✓ DELETE /api/staging/:sessionId purged all assets completely');

  // Test 4g: Cleanup nested folder via DELETE /api/staging/<nestedPath>
  const deleteNestedRes = await app.inject({
    method: 'DELETE',
    url: `/api/staging/${nestedFolderPath}`,
    headers: { 'x-api-key': 'test_secret_api_key_123' }
  });
  assert.strictEqual(deleteNestedRes.statusCode, 200);
  assert(!fs.existsSync(path.join(STAGING_ROOT, nestedFolderPath)), 'Nested folder must be purged');
  console.log('✓ DELETE /api/staging/<nestedPath> successfully purged nested folder');

  console.log('ALL STAGING TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
