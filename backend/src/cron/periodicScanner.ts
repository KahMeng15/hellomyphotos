import { scannerQueue } from '../queue/scannerQueue';
import { redis } from '../config/redis';

// Simple interval-based cron using setInterval (can be replaced with 'node-cron' or BullMQ repeatable jobs)
const checkInterval = async () => {
  try {
    const scanIntervalStr = await redis.get('settings:scan_interval');
    // Default to 1 hour (3600000 ms) if not set
    const intervalMs = scanIntervalStr ? parseInt(scanIntervalStr, 10) : 3600000;
    
    // Add job to scan root folder periodically
    console.log(`[Cron] Adding periodic root scan job. Next run in ${intervalMs}ms`);
    await scannerQueue.add('scan-directory', { folderPath: '' });

    setTimeout(checkInterval, intervalMs);
  } catch (error) {
    console.error(`[Cron] Error scheduling periodic scan`, error);
    setTimeout(checkInterval, 3600000); // Retry in 1 hour
  }
}

// Start cron
setTimeout(checkInterval, 10000); // Start first run after 10s of boot
