import crypto from 'crypto';
import { redis } from '../../config/redis';
import { query } from '../../config/db';
import { parseUserAgent } from '../../utils/userAgent';

const IP_HASH_SALT = process.env.ANALYTICS_IP_SALT || 'hellomyphotos_analytics';
const VISITS_QUEUE_KEY = 'analytics_visits:queue';

export function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(`${IP_HASH_SALT}:${ip}`).digest('hex');
}

export interface VisitRecord {
  mediaId?: string | null;
  shareToken?: string | null;
  actionType: string;
  ip: string;
  userAgent?: string | null;
  referrer?: string | null;
  path?: string | null;
  folderPath?: string | null;
}

export class AnalyticsService {
  static async logView(mediaId: string, actionType: string, bytesServed: number, shareToken?: string) {
    try {
      // Buffer in Redis to prevent DB write locking
      const key = `analytics:${actionType}:${mediaId || 'null'}:${shareToken || 'null'}`;
      await redis.hincrby(key, 'count', 1);
      await redis.hincrby(key, 'bytes', bytesServed);
    } catch (error) {
      console.error('[Analytics] Failed to log view', error);
    }
  }

  static async logVisit(record: VisitRecord) {
    try {
      const ua = parseUserAgent(record.userAgent || '');
      const entry = {
        media_id: record.mediaId || null,
        share_token: record.shareToken || null,
        action_type: record.actionType,
        ip: (record.ip || 'unknown').slice(0, 45),
        ip_hash: hashIp(record.ip || 'unknown'),
        user_agent: (record.userAgent || '').slice(0, 300) || null,
        os: ua.os,
        browser: ua.browser,
        device_type: ua.deviceType,
        referrer: (record.referrer || '').slice(0, 500) || null,
        path: (record.path || '').slice(0, 500) || null,
        folder_path: (record.folderPath || '').slice(0, 500) || null
      };
      await redis.rpush(VISITS_QUEUE_KEY, JSON.stringify(entry));
    } catch (error) {
      console.error('[Analytics] Failed to log visit', error);
    }
  }

  static async flushToPostgres() {
    try {
      // Flush aggregated media view counters
      const keys = await redis.keys('analytics:*');
      if (keys.length > 0) {
        for (const key of keys) {
          const parts = key.split(':'); // ['analytics', actionType, mediaId, shareToken]
          if (parts.length !== 4) continue;

          const actionType = parts[1];
          const mediaId = parts[2] === 'null' ? null : parts[2];
          const shareToken = parts[3] === 'null' ? null : parts[3];

          const data = await redis.hgetall(key);
          const count = parseInt(data.count || '0', 10);
          const bytes = parseInt(data.bytes || '0', 10);

          if (count > 0) {
            // Bulk insert (in a real system you'd batch these queries)
            for (let i = 0; i < count; i++) {
              await query(`
                INSERT INTO media_analytics (media_id, share_token, action_type, bytes_served, ip_hash)
                VALUES ($1, $2, $3, $4, 'batch')
              `, [mediaId, shareToken, actionType, Math.floor(bytes / count)]);
            }
            // Delete from Redis once flushed
            await redis.del(key);
          }
        }
      }

      // Flush buffered visit events in a single multi-row insert
      const queued = await redis.lrange(VISITS_QUEUE_KEY, 0, -1);
      if (queued.length > 0) {
        await redis.del(VISITS_QUEUE_KEY);
        const rows = queued
          .map(q => { try { return JSON.parse(q); } catch { return null; } })
          .filter(Boolean);

        const columns = ['media_id', 'share_token', 'action_type', 'ip', 'ip_hash', 'user_agent', 'os', 'browser', 'device_type', 'referrer', 'path', 'folder_path'];
        const perRow = columns.length;

        // Chunk to stay well under Postgres' 65535 parameter limit
        for (let i = 0; i < rows.length; i += 200) {
          const chunk = rows.slice(i, i + 200);
          const params: any[] = [];
          const placeholders: string[] = [];
          chunk.forEach((row, idx) => {
            const base = idx * perRow;
            columns.forEach((col, j) => params.push(row[col] ?? null));
            placeholders.push(`(${columns.map((_, j) => `$${base + j + 1}`).join(', ')})`);
          });
          await query(
            `INSERT INTO analytics_visits (${columns.join(', ')}) VALUES ${placeholders.join(', ')}`,
            params
          );
        }
      }
    } catch (error) {
      console.error('[Analytics] Failed to flush to postgres', error);
    }
  }
}
