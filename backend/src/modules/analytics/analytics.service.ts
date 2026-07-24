import { redis } from '../../config/redis';
import { query } from '../../config/db';

export class AnalyticsService {
  static async logView(mediaId: string, actionType: string, bytesServed: number) {
    try {
      // Buffer in Redis to prevent DB write locking
      // HINCRBY media_analytics:actionType:mediaId bytesServed
      const key = `analytics:${actionType}:${mediaId}`;
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
        const parts = key.split(':'); // ['analytics', actionType, mediaId]
        if (parts.length !== 3) continue;

        const actionType = parts[1];
        const mediaId = parts[2];
        
        const data = await redis.hgetall(key);
        const count = parseInt(data.count || '0', 10);
        const bytes = parseInt(data.bytes || '0', 10);

        if (count > 0) {
          // Bulk insert (in a real system you'd batch these queries)
          for (let i = 0; i < count; i++) {
            await query(`
              INSERT INTO media_analytics (media_id, action_type, bytes_served, ip_hash)
              VALUES ($1, $2, $3, 'batch')
            `, [mediaId, actionType, Math.floor(bytes / count)]);
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
