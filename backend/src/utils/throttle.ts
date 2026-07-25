import { Transform } from 'stream';
import type { TransformCallback } from 'stream';
import { redis } from '../config/redis';

export class BandwidthThrottler extends Transform {
  private bytesPerSecond: number;
  private bytesPassed = 0;
  private startTime = Date.now();

  constructor(bytesPerSecond: number) {
    super();
    this.bytesPerSecond = bytesPerSecond;
  }

  _transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback) {
    if (this.bytesPerSecond <= 0) {
      // 0 means no throttling
      return callback(null, chunk);
    }
    
    this.bytesPassed += chunk.length;
    const elapsed = (Date.now() - this.startTime) / 1000;
    const expectedElapsed = this.bytesPassed / this.bytesPerSecond;

    const delay = (expectedElapsed - elapsed) * 1000;
    if (delay > 0) {
      setTimeout(() => callback(null, chunk), delay);
    } else {
      callback(null, chunk);
    }
  }
}

// Helper to fetch the current limits from settings (cached in redis, but ideally in db if we moved it, but let's assume it's in Redis or we query DB).
import { query } from '../config/db';

let limitCache: { authLimit: number, publicLimit: number, expireAt: number } | null = null;

export async function getThrottleLimit(isAuthenticated: boolean): Promise<number> {
  // Simple cache for 10 seconds to avoid hitting DB every request chunk
  if (!limitCache || Date.now() > limitCache.expireAt) {
    const { rows } = await query(`SELECT key, value FROM admin_settings WHERE key IN ('throttle_auth', 'throttle_public')`);
    
    let authLimit = 0;
    let publicLimit = 0;
    
    for (const r of rows) {
      if (r.key === 'throttle_auth') authLimit = Number(r.value) || 0;
      if (r.key === 'throttle_public') publicLimit = Number(r.value) || 0;
    }
    
    limitCache = { authLimit, publicLimit, expireAt: Date.now() + 10000 };
  }
  
  return (isAuthenticated ? limitCache.authLimit : limitCache.publicLimit) * 125000;
}
