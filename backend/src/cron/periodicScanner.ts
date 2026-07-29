import { query } from '../config/db';

// H-4 Fix: Read scan interval from the admin_settings DB table (where the admin panel writes it),
// not from a Redis key ('settings:scan_interval') that was never populated by the settings save logic.
const DEFAULT_SCAN_INTERVAL_MS = 3_600_000; // 1 hour

async function getScanIntervalMs(): Promise<number> {
  try {
    const res = await query(`SELECT value FROM admin_settings WHERE key = 'scan_interval'`);
    if (res.rows.length > 0) {
      const val = JSON.parse(res.rows[0].value);
      const ms = parseInt(String(val), 10);
      if (!isNaN(ms) && ms > 0) return ms;
    }
  } catch (err) {
    console.error('[Cron] Failed to read scan_interval from DB, using default:', err);
  }
  return DEFAULT_SCAN_INTERVAL_MS;
}

const checkInterval = async () => {
  try {
    const intervalMs = await getScanIntervalMs();
    console.log(`[Cron] Adding periodic full scan job. Next run in ${intervalMs}ms`);
    const { ScannerService } = await import('../modules/scanner/scanner.service');
    await ScannerService.scanAllDirectories('');
    setTimeout(checkInterval, intervalMs);
  } catch (error) {
    console.error('[Cron] Error scheduling periodic scan', error);
    setTimeout(checkInterval, DEFAULT_SCAN_INTERVAL_MS); // Retry at default interval
  }
};

// Start cron — first run 10s after boot to allow DB/Redis to stabilise
setTimeout(checkInterval, 10_000);
