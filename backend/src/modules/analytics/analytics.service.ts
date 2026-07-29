import { redis } from '../../config/redis';
import { query } from '../../config/db';

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

  static async flushToPostgres() {
    try {
      // Find all analytics keys
      const keys = await redis.keys('analytics:*');
      if (keys.length === 0) return;

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
    } catch (error) {
      console.error('[Analytics] Failed to flush to postgres', error);
    }
  }
}
