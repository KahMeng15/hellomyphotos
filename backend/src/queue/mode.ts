import { redis } from '../config/redis';

export type QueueExecutionMode = 'pipeline' | 'batch';

let inMemoryMode: QueueExecutionMode = 'pipeline';
let modeCacheTime = 0;
const MODE_CACHE_TTL_MS = 5000; // Cache for 5s to avoid per-job Redis round-trips

export async function getExecutionMode(): Promise<QueueExecutionMode> {
  const now = Date.now();
  if (now - modeCacheTime < MODE_CACHE_TTL_MS) {
    return inMemoryMode; // Use cached value — avoids Redis round-trip per job
  }
  try {
    const val = await redis.get('queue:execution_mode');
    if (val === 'pipeline' || val === 'batch') {
      inMemoryMode = val;
    }
  } catch (err) {
    console.error('[Queue Mode] Failed to read mode from Redis:', err);
  }
  modeCacheTime = now;
  return inMemoryMode;
}

export async function setExecutionMode(mode: QueueExecutionMode): Promise<QueueExecutionMode> {
  if (mode !== 'pipeline' && mode !== 'batch') {
    throw new Error("Invalid execution mode. Expected 'pipeline' or 'batch'");
  }
  inMemoryMode = mode;
  modeCacheTime = Date.now();
  try {
    await redis.set('queue:execution_mode', mode);
  } catch (err) {
    console.error('[Queue Mode] Failed to save mode to Redis:', err);
  }
  return inMemoryMode;
}
