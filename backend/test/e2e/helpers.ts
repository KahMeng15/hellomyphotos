import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { app } from '../../src/app';
import { query, pool } from '../../src/config/db';
import { redis } from '../../src/config/redis';
import { queues } from '../../src/queue';

const defaultCacheDir = fs.existsSync('/app/cache') ? '/app/cache' : path.resolve(process.cwd(), 'volumes/cache_rw');
const defaultMediaDir = fs.existsSync('/app/media') ? '/app/media' : path.resolve(process.cwd(), 'volumes/media_ro');

export const CACHE_ROOT = process.env.CACHE_ROOT || defaultCacheDir;
export const MEDIA_ROOT = process.env.MEDIA_ROOT || defaultMediaDir;

let serverPort: number = 0;
let serverUrl: string = '';
let isServerStarted = false;
let testAdminToken: string = '';
export const TEST_ADMIN_PASSWORD = 'TestAdminSecretPassword123!';

export async function ensureServerStarted(): Promise<{ url: string; port: number }> {
  if (isServerStarted) {
    return { url: serverUrl, port: serverPort };
  }
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const match = address.match(/:(\d+)$/);
    serverPort = match ? parseInt(match[1], 10) : 3000;
    serverUrl = `http://127.0.0.1:${serverPort}`;
    isServerStarted = true;
    console.log(`[E2E Setup] Backend test server listening on ${serverUrl}`);
  } catch (err: any) {
    if (err.code === 'ERR_SERVER_ALREADY_LISTEN') {
      serverPort = 3000;
      serverUrl = 'http://127.0.0.1:3000';
      isServerStarted = true;
    } else {
      throw err;
    }
  }
  return { url: serverUrl, port: serverPort };
}

export async function ensureTestAdminUser(): Promise<{ token: string; headers: Record<string, string> }> {
  const adminEmail = 'e2e_admin@hellomyphotos.local';
  const passHash = await bcrypt.hash(TEST_ADMIN_PASSWORD, 10);

  const existing = await query('SELECT id FROM users WHERE email = $1', [adminEmail]);
  let adminId: string;

  if (existing.rows.length > 0) {
    adminId = existing.rows[0].id;
    await query('UPDATE users SET password_hash = $1, role = $2 WHERE id = $3', [passHash, 'super_admin', adminId]);
  } else {
    const created = await query(
      'INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [adminEmail, 'E2E Admin', passHash, 'super_admin']
    );
    adminId = created.rows[0].id;
  }

  // Generate JWT token
  const secret = process.env.JWT_SECRET || 'super_secret_jwt_key_please_change';
  testAdminToken = jwt.sign({ id: adminId, email: adminEmail, role: 'super_admin' }, secret, { expiresIn: '1d' });

  const headers = {
    'Authorization': `Bearer ${testAdminToken}`,
    'Cookie': `token=${testAdminToken}`,
    'x-admin-password': TEST_ADMIN_PASSWORD,
    'Content-Type': 'application/json'
  };

  return { token: testAdminToken, headers };
}

export async function createTestImage(filename: string, width = 640, height = 480, color = { r: 100, g: 150, b: 200 }): Promise<string> {
  const testDir = path.join(MEDIA_ROOT, 'e2e_test_dir');
  fs.mkdirSync(testDir, { recursive: true });
  const filePath = path.join(testDir, filename);

  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color
    }
  })
  .jpeg({ quality: 90 })
  .toFile(filePath);

  return filePath;
}

export async function createTestVideo(filename: string): Promise<string> {
  const testDir = path.join(MEDIA_ROOT, 'e2e_test_dir');
  fs.mkdirSync(testDir, { recursive: true });
  const filePath = path.join(testDir, filename);

  try {
    // Generate a real, playable MP4 so transcoding has actual video to process.
    execSync(
      `ffmpeg -y -f lavfi -i testsrc=duration=1:size=320x240:rate=10 -c:v libx264 -pix_fmt yuv420p "${filePath}"`,
      { stdio: 'ignore' }
    );
  } catch {
    // Fallback: minimal MP4 header buffer if ffmpeg is unavailable.
    const dummyMp4Buffer = Buffer.from([
      0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
      0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
      0x61, 0x76, 0x63, 0x31, 0x6d, 0x70, 0x34, 0x31
    ]);
    await fs.promises.writeFile(filePath, dummyMp4Buffer);
  }
  return filePath;
}

export async function cleanupTestData(): Promise<void> {
  const testDir = path.join(MEDIA_ROOT, 'e2e_test_dir');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  await query("DELETE FROM media_files WHERE folder_path LIKE 'e2e_test_dir%'");
}

export async function closeConnections(): Promise<void> {
  try {
    for (const q of Object.values(queues)) {
      await q.close();
    }
    await app.close();
  } catch (e) {}
}
