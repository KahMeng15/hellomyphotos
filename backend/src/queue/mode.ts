import { redis } from '../config/redis';

export type QueueExecutionMode = 'sequential' | 'concurrent';

let inMemoryMode: QueueExecutionMode = 'sequential';

export async function getExecutionMode(): Promise<QueueExecutionMode> {
  try {
    const val = await redis.get('queue:execution_mode');
    if (val === 'concurrent' || val === 'sequential') {
      inMemoryMode = val;
      return val;
    }
  } catch (err) {
    console.error('[Queue Mode] Failed to read mode from Redis:', err);
  }
  return inMemoryMode;
}

export async function setExecutionMode(mode: QueueExecutionMode): Promise<QueueExecutionMode> {
  if (mode !== 'sequential' && mode !== 'concurrent') {
    throw new Error("Invalid execution mode. Expected 'sequential' or 'concurrent'");
  }
  inMemoryMode = mode;
  try {
    await redis.set('queue:execution_mode', mode);
  } catch (err) {
    console.error('[Queue Mode] Failed to save mode to Redis:', err);
  }
  return inMemoryMode;
}
