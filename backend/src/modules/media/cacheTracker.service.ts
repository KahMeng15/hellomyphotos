import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { redis } from '../../config/redis';
import { query } from '../../config/db';
import { logger } from '../../utils/logger';

const execAsync = promisify(exec);

const defaultCacheDir = fs.existsSync('/app/cache') 
  ? '/app/cache' 
  : path.resolve(process.cwd(), '../volumes/cache_rw');

export const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || defaultCacheDir);

const REDIS_BREAKDOWN_KEY = 'cache:breakdown';
const REDIS_TOTAL_KEY = 'cache:total_bytes';
const DB_SETTING_KEY = 'cache_stats';

export class CacheTrackerService {
  private static isInitialized = false;
  private static initPromise: Promise<void> | null = null;
  private static dbSyncTimeout: NodeJS.Timeout | null = null;

  /**
   * Extract top-level category name from file path or category string.
   * e.g., "/app/cache/1080p/abc.webp" -> "1080p"
   *       "/app/cache/transcoded/mp4/xyz.mp4" -> "transcoded"
   *       "faces" -> "faces"
   */
  static extractCategory(filePathOrCategory: string): string {
    if (!filePathOrCategory) return 'other';
    const normalized = path.normalize(filePathOrCategory);
    if (!normalized.includes(path.sep) && !normalized.includes('/')) {
      return normalized;
    }
    const resolved = path.resolve(normalized);
    if (resolved.startsWith(CACHE_ROOT)) {
      const rel = path.relative(CACHE_ROOT, resolved);
      const segments = rel.split(path.sep).filter(Boolean);
      return segments[0] || 'other';
    }
    const segments = normalized.split(path.sep).filter(Boolean);
    return segments[0] || 'other';
  }

  /**
   * Record a file write/creation into the cache.
   */
  static async recordWrite(categoryOrPath: string, bytes: number): Promise<void> {
    if (!bytes || bytes <= 0 || isNaN(bytes)) return;
    const category = this.extractCategory(categoryOrPath);

    try {
      await redis.hincrby(REDIS_BREAKDOWN_KEY, category, Math.round(bytes));
      await redis.incrby(REDIS_TOTAL_KEY, Math.round(bytes));
      this.scheduleDbSync();
    } catch (err: any) {
      logger.warn(`[CacheTracker] Failed to record write for ${category}: ${err.message}`);
    }
  }

  /**
   * Record a file deletion from the cache.
   */
  static async recordDelete(categoryOrPath: string, bytes: number): Promise<void> {
    if (!bytes || bytes <= 0 || isNaN(bytes)) return;
    const category = this.extractCategory(categoryOrPath);

    try {
      await redis.hincrby(REDIS_BREAKDOWN_KEY, category, -Math.round(bytes));
      await redis.incrby(REDIS_TOTAL_KEY, -Math.round(bytes));
      this.scheduleDbSync();
    } catch (err: any) {
      logger.warn(`[CacheTracker] Failed to record delete for ${category}: ${err.message}`);
    }
  }

  /**
   * Record an entire category / subdirectory being cleared or wiped.
   */
  static async recordDirWiped(categoryOrPath: string): Promise<void> {
    const category = this.extractCategory(categoryOrPath);

    try {
      const prevValStr = await redis.hget(REDIS_BREAKDOWN_KEY, category);
      const prevVal = prevValStr ? Math.max(0, parseInt(prevValStr, 10) || 0) : 0;

      await redis.hset(REDIS_BREAKDOWN_KEY, category, '0');
      if (prevVal > 0) {
        await redis.incrby(REDIS_TOTAL_KEY, -prevVal);
      }
      this.scheduleDbSync();
    } catch (err: any) {
      logger.warn(`[CacheTracker] Failed to record dir wiped for ${category}: ${err.message}`);
    }
  }

  /**
   * Unlink a cached file and automatically track its deletion size.
   */
  static async unlinkFile(filePath: string, explicitCategory?: string): Promise<boolean> {
    try {
      if (!fs.existsSync(filePath)) return false;
      const stat = await fs.promises.stat(filePath).catch(() => null);
      await fs.promises.unlink(filePath);
      if (stat && stat.size > 0) {
        await this.recordDelete(explicitCategory || filePath, stat.size);
      }
      return true;
    } catch (err: any) {
      return false;
    }
  }

  /**
   * Synchronous unlink with size tracking.
   */
  static unlinkFileSync(filePath: string, explicitCategory?: string): boolean {
    try {
      if (!fs.existsSync(filePath)) return false;
      const stat = fs.statSync(filePath);
      fs.unlinkSync(filePath);
      if (stat && stat.size > 0) {
        this.recordDelete(explicitCategory || filePath, stat.size).catch(() => {});
      }
      return true;
    } catch (err: any) {
      return false;
    }
  }

  /**
   * Get total cache size and per-category breakdown in < 1ms from Redis/DB.
   */
  static async getCacheStats(): Promise<{ size: number; breakdown: { name: string; bytes: number }[] }> {
    await this.ensureInitialized();

    try {
      const hash = await redis.hgetall(REDIS_BREAKDOWN_KEY);
      if (!hash || Object.keys(hash).length === 0) {
        // Fallback: sync from disk if Redis was flushed
        return await this.syncFromDisk();
      }

      let total = 0;
      const breakdown: { name: string; bytes: number }[] = [];

      for (const [name, bytesStr] of Object.entries(hash)) {
        const rawBytes = parseInt(bytesStr, 10) || 0;
        const bytes = Math.max(0, rawBytes);
        total += bytes;
        breakdown.push({ name, bytes });
      }

      breakdown.sort((a, b) => b.bytes - a.bytes);

      return {
        size: Math.max(0, total),
        breakdown
      };
    } catch (err: any) {
      logger.error(`[CacheTracker] getCacheStats failed: ${err.message}`);
      return { size: 0, breakdown: [] };
    }
  }

  /**
   * Ensure tracking is initialized from Redis, DB, or Disk.
   */
  static async ensureInitialized(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const keyCount = await redis.hlen(REDIS_BREAKDOWN_KEY);
        if (keyCount > 0) {
          this.isInitialized = true;
          return;
        }

        // Check if DB admin_settings has a saved snapshot
        const dbRes = await query(
          `SELECT value FROM admin_settings WHERE key = $1`,
          [DB_SETTING_KEY]
        ).catch(() => ({ rows: [] }));

        if (dbRes.rows.length > 0 && dbRes.rows[0].value) {
          const data = typeof dbRes.rows[0].value === 'string'
            ? JSON.parse(dbRes.rows[0].value)
            : dbRes.rows[0].value;

          if (data && data.breakdown && typeof data.breakdown === 'object') {
            const pipeline = redis.pipeline();
            let sum = 0;
            for (const [cat, bytes] of Object.entries(data.breakdown)) {
              const b = Math.max(0, Number(bytes) || 0);
              pipeline.hset(REDIS_BREAKDOWN_KEY, cat, b.toString());
              sum += b;
            }
            pipeline.set(REDIS_TOTAL_KEY, sum.toString());
            await pipeline.exec();
            this.isInitialized = true;
            return;
          }
        }

        // No Redis data and no DB data: perform initial disk sync
        await this.syncFromDisk();
        this.isInitialized = true;
      } catch (err: any) {
        logger.warn(`[CacheTracker] Initialization error: ${err.message}`);
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Reconcile / sync stats directly from disk.
   * Fast execution using `du -sb /app/cache/*` on Linux, falling back to directory stat loop.
   */
  static async syncFromDisk(): Promise<{ size: number; breakdown: { name: string; bytes: number }[] }> {
    const breakdownMap: Record<string, number> = {};
    let total = 0;

    try {
      if (!fs.existsSync(CACHE_ROOT)) {
        await fs.promises.mkdir(CACHE_ROOT, { recursive: true });
      }

      let duSuccess = false;
      try {
        // Fast path: use du -sb on Linux / container
        const { stdout } = await execAsync(`du -sb "${CACHE_ROOT}"/* 2>/dev/null`, { timeout: 10000 });
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          const match = line.trim().match(/^(\d+)\s+(.+)$/);
          if (match) {
            const bytes = parseInt(match[1], 10) || 0;
            const fullPath = match[2];
            const name = path.basename(fullPath);
            if (name) {
              breakdownMap[name] = bytes;
              total += bytes;
              duSuccess = true;
            }
          }
        }
      } catch {
        duSuccess = false;
      }

      // Fallback if du is unavailable
      if (!duSuccess) {
        const entries = await fs.promises.readdir(CACHE_ROOT, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          const full = path.join(CACHE_ROOT, entry.name);
          if (entry.isDirectory()) {
            const size = await this.walkDirSize(full);
            breakdownMap[entry.name] = size;
            total += size;
          } else if (entry.isFile()) {
            try {
              const s = (await fs.promises.stat(full)).size;
              breakdownMap[entry.name] = s;
              total += s;
            } catch {}
          }
        }
      }

      // Update Redis atomically
      const pipeline = redis.pipeline();
      pipeline.del(REDIS_BREAKDOWN_KEY);
      for (const [cat, b] of Object.entries(breakdownMap)) {
        pipeline.hset(REDIS_BREAKDOWN_KEY, cat, b.toString());
      }
      pipeline.set(REDIS_TOTAL_KEY, total.toString());
      await pipeline.exec();

      // Persist snapshot to DB
      await this.saveToDb(total, breakdownMap);

      const breakdown = Object.entries(breakdownMap)
        .map(([name, bytes]) => ({ name, bytes }))
        .sort((a, b) => b.bytes - a.bytes);

      logger.info(`[CacheTracker] Synced cache from disk: total ${total} bytes across ${breakdown.length} subfolders.`);
      return { size: total, breakdown };
    } catch (err: any) {
      logger.error(`[CacheTracker] syncFromDisk failed: ${err.message}`);
      return { size: 0, breakdown: [] };
    }
  }

  private static async walkDirSize(dir: string): Promise<number> {
    let total = 0;
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile()) {
          try {
            total += (await fs.promises.stat(full)).size;
          } catch {}
        }
      }
    }
    return total;
  }

  private static scheduleDbSync(): void {
    if (this.dbSyncTimeout) return;
    this.dbSyncTimeout = setTimeout(() => {
      this.dbSyncTimeout = null;
      this.persistCurrentStatsToDb().catch(() => {});
    }, 5000);
  }

  private static async persistCurrentStatsToDb(): Promise<void> {
    try {
      const hash = await redis.hgetall(REDIS_BREAKDOWN_KEY);
      if (!hash) return;
      let total = 0;
      const breakdownMap: Record<string, number> = {};
      for (const [k, v] of Object.entries(hash)) {
        const b = Math.max(0, parseInt(v, 10) || 0);
        breakdownMap[k] = b;
        total += b;
      }
      await this.saveToDb(total, breakdownMap);
    } catch {}
  }

  private static async saveToDb(total: number, breakdown: Record<string, number>): Promise<void> {
    const payload = JSON.stringify({
      total,
      breakdown,
      updated_at: new Date().toISOString()
    });
    await query(
      `INSERT INTO admin_settings (key, value, updated_at) 
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [DB_SETTING_KEY, payload]
    ).catch(() => {});
  }
}
