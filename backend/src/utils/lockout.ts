import { query } from '../config/db';
import { redis } from '../config/redis';

export interface LockoutStatus {
  isLockedOut: boolean;
  remainingMinutes: number;
  blockedUntil: number;
  attempts: number;
  currentPenalty: number;
  maxTries: number;
  doubleTimeout: boolean;
  redisKey: string;
}

/**
 * Reads global lockout settings from admin_settings and checks whether the given key is locked out.
 * Reusable across user login, share unlock, and OTP claim endpoints.
 */
export async function getLockoutStatus(redisKey: string): Promise<LockoutStatus> {
  const { rows: settingsRows } = await query(`
    SELECT key, value FROM admin_settings 
    WHERE key IN ('auth_max_login_tries', 'auth_timeout_minutes', 'auth_double_timeout')
  `);

  let maxTries = 5;
  let timeoutMinutes = 15;
  let doubleTimeout = true;

  for (const r of settingsRows) {
    try {
      if (r.key === 'auth_max_login_tries') {
        const v = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
        maxTries = Number(v) || 5;
      }
      if (r.key === 'auth_timeout_minutes') {
        const v = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
        timeoutMinutes = Number(v) || 15;
      }
      if (r.key === 'auth_double_timeout') {
        const v = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
        doubleTimeout = typeof v === 'string' ? v === 'true' : Boolean(v);
      }
    } catch (e) {}
  }

  const attemptsData = await redis.get(redisKey);
  let attempts = 0;
  let currentPenalty = timeoutMinutes * 60; // in seconds
  let blockedUntil = 0;

  if (attemptsData) {
    try {
      const parsed = JSON.parse(attemptsData);
      attempts = parsed.attempts || 0;
      currentPenalty = parsed.currentPenalty || (timeoutMinutes * 60);
      blockedUntil = parsed.blockedUntil || 0;

      if (Date.now() < blockedUntil) {
        const remainingMinutes = Math.ceil((blockedUntil - Date.now()) / 60000);
        return {
          isLockedOut: true,
          remainingMinutes,
          blockedUntil,
          attempts,
          currentPenalty,
          maxTries,
          doubleTimeout,
          redisKey
        };
      }
    } catch (e) {}
  }

  return {
    isLockedOut: false,
    remainingMinutes: 0,
    blockedUntil: 0,
    attempts,
    currentPenalty,
    maxTries,
    doubleTimeout,
    redisKey
  };
}

/**
 * Records a failed attempt for the given lockout status, applying penalties if threshold is exceeded.
 */
export async function recordFailedAttempt(lockout: LockoutStatus): Promise<{ isLockedOut: boolean; remainingMinutes: number; remainingTries: number }> {
  let newAttempts = (lockout.attempts || 0) + 1;
  let newBlockedUntil = 0;
  let newPenalty = lockout.currentPenalty;

  if (newAttempts >= lockout.maxTries) {
    newBlockedUntil = Date.now() + (newPenalty * 1000);
    if (lockout.doubleTimeout) {
      newPenalty = newPenalty * 2;
    }
    newAttempts = 0;
  }

  await redis.set(lockout.redisKey, JSON.stringify({
    attempts: newAttempts,
    currentPenalty: newPenalty,
    blockedUntil: newBlockedUntil
  }), 'EX', 86400 * 7);

  if (newBlockedUntil > 0) {
    const remainingMinutes = Math.ceil((newBlockedUntil - Date.now()) / 60000);
    return { isLockedOut: true, remainingMinutes, remainingTries: 0 };
  }

  const remainingTries = Math.max(0, lockout.maxTries - newAttempts);
  return { isLockedOut: false, remainingMinutes: 0, remainingTries };
}

/**
 * Clears lockout attempts on successful action.
 */
export async function clearLockout(redisKey: string): Promise<void> {
  await redis.del(redisKey).catch(() => {});
}
