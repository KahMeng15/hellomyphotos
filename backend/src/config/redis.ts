import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

export const redis = new Redis({
  host: redisHost,
  port: redisPort,
  maxRetriesPerRequest: null,
});

/**
 * Non-blocking key scanner using Redis SCAN stream.
 * Unlike redis.keys(), this does NOT block the Redis single thread.
 */
export async function scanKeys(pattern: string, count = 100): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const stream = redis.scanStream({
      match: pattern,
      count,
    });
    const keys: string[] = [];
    stream.on('data', (resultKeys: string[]) => {
      for (let i = 0; i < resultKeys.length; i++) {
        keys.push(resultKeys[i]);
      }
    });
    stream.on('end', () => resolve(keys));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Non-blocking pattern-based key deletion using Redis SCAN stream.
 * Batches deletion in non-blocking chunks without loading all keys into memory.
 */
export async function deleteKeysByPattern(pattern: string, count = 100): Promise<number> {
  return new Promise((resolve, reject) => {
    const stream = redis.scanStream({
      match: pattern,
      count,
    });
    let totalDeleted = 0;
    stream.on('data', async (resultKeys: string[]) => {
      if (resultKeys.length > 0) {
        stream.pause();
        try {
          await redis.del(...resultKeys);
          totalDeleted += resultKeys.length;
        } catch (err) {
          // ignore individual chunk error and continue
        } finally {
          stream.resume();
        }
      }
    });
    stream.on('end', () => resolve(totalDeleted));
    stream.on('error', (err) => reject(err));
  });
}
