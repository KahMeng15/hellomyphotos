import { pool } from '../config/db.js';

let cachedLockdown: boolean | null = null;
let lastCheck = 0;
const CACHE_TTL_MS = 2000;

export async function isShareLockdownActive(): Promise<boolean> {
  const now = Date.now();
  if (cachedLockdown !== null && (now - lastCheck) < CACHE_TTL_MS) {
    return cachedLockdown;
  }
  try {
    const res = await pool.query(`SELECT value FROM admin_settings WHERE key = 'shares_lockdown_mode'`);
    if (res.rows.length > 0) {
      const val = res.rows[0].value;
      cachedLockdown = val === true || val === 'true' || val === 1 || (typeof val === 'object' && val !== null && (val as any).enabled === true);
    } else {
      cachedLockdown = false;
    }
  } catch (e) {
    cachedLockdown = false;
  }
  lastCheck = now;
  return cachedLockdown;
}

export async function setShareLockdown(enabled: boolean): Promise<boolean> {
  await pool.query(
    `INSERT INTO admin_settings (key, value) VALUES ('shares_lockdown_mode', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
    [JSON.stringify(enabled)]
  );
  cachedLockdown = enabled;
  lastCheck = Date.now();
  return enabled;
}
