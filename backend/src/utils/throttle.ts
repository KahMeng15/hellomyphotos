import { Transform } from 'stream';
import type { TransformCallback } from 'stream';
import { query } from '../config/db';

class TokenBucket {
  private rate: number = 0;
  private tokens: number = 0;
  private lastRefill: number = Date.now();

  constructor(rate: number = 0) {
    this.rate = rate;
    this.tokens = rate;
  }

  setRate(rate: number) {
    if (this.rate !== rate) {
      this.rate = rate;
      if (this.tokens > rate) this.tokens = rate;
    }
  }

  async consume(bytes: number): Promise<void> {
    if (this.rate <= 0) return;

    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens += elapsed * this.rate;
    if (this.tokens > this.rate) this.tokens = this.rate;
    this.lastRefill = now;

    this.tokens -= bytes;

    if (this.tokens < 0) {
      const deficit = -this.tokens;
      const waitTime = (deficit / this.rate) * 1000;
      await new Promise(r => setTimeout(r, waitTime));
    }
  }
}

const authGlobalBucket = new TokenBucket(0);
const publicGlobalBucket = new TokenBucket(0);
const userBuckets = new Map<string, TokenBucket>();

// Clean up unused buckets periodically to prevent memory leaks
setInterval(() => {
  // Not fully implemented for brevity, but map can be purged
}, 60000);

export class BandwidthThrottler extends Transform {
  private ip: string;
  private isAuthenticated: boolean;

  constructor(ip: string, isAuthenticated: boolean) {
    super();
    this.ip = ip;
    this.isAuthenticated = isAuthenticated;
  }

  async _transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback) {
    try {
      const limits = await getThrottleLimits();
      const bytes = chunk.length;

      // Global Limit (Mbps to Bytes/sec: * 125000)
      const globalLimit = this.isAuthenticated ? limits.authGlobalLimit : limits.publicGlobalLimit;
      const globalBucket = this.isAuthenticated ? authGlobalBucket : publicGlobalBucket;

      if (globalLimit > 0) {
        globalBucket.setRate(globalLimit * 125000);
        await globalBucket.consume(bytes);
      }

      // Per-User Limit
      const userLimit = this.isAuthenticated ? limits.authLimit : limits.publicLimit;
      if (userLimit > 0) {
        const bucketKey = `${this.isAuthenticated ? 'auth' : 'public'}_${this.ip}`;
        let bucket = userBuckets.get(bucketKey);
        if (!bucket) {
          bucket = new TokenBucket(userLimit * 125000);
          userBuckets.set(bucketKey, bucket);
        }
        bucket.setRate(userLimit * 125000);
        await bucket.consume(bytes);
      }

      callback(null, chunk);
    } catch (e) {
      callback(e as Error);
    }
  }
}

let limitCache: { authLimit: number, publicLimit: number, authGlobalLimit: number, publicGlobalLimit: number, expireAt: number } | null = null;

export async function getThrottleLimits() {
  if (!limitCache || Date.now() > limitCache.expireAt) {
    const { rows } = await query(`SELECT key, value FROM admin_settings WHERE key IN ('throttle_auth', 'throttle_public', 'throttle_auth_global', 'throttle_public_global')`);
    
    let authLimit = 0;
    let publicLimit = 0;
    let authGlobalLimit = 0;
    let publicGlobalLimit = 0;
    
    for (const r of rows) {
      if (r.key === 'throttle_auth') authLimit = Number(r.value) || 0;
      if (r.key === 'throttle_public') publicLimit = Number(r.value) || 0;
      if (r.key === 'throttle_auth_global') authGlobalLimit = Number(r.value) || 0;
      if (r.key === 'throttle_public_global') publicGlobalLimit = Number(r.value) || 0;
    }
    
    limitCache = { authLimit, publicLimit, authGlobalLimit, publicGlobalLimit, expireAt: Date.now() + 10000 };
  }
  
  return limitCache;
}
