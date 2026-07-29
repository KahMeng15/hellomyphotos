import { query } from '../config/db';

const DEFAULT_SCAN_INTERVAL_MS = 3_600_000; // 1 hour

interface ScanSchedule {
  type: 'off' | 'daily' | 'weekly' | 'monthly';
  hour: number;
  minute: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
}

async function getScanIntervalMs(): Promise<number | null> {
  try {
    const res = await query(`SELECT value FROM admin_settings WHERE key = 'scan_interval'`);
    if (res.rows.length > 0) {
      const val = JSON.parse(res.rows[0].value);
      const ms = parseInt(String(val), 10);
      if (!isNaN(ms) && ms > 0) return ms;
    }
  } catch (err) {
    console.error('[Cron] Failed to read scan_interval from DB:', err);
  }
  return null;
}

async function getScanSchedule(): Promise<ScanSchedule | null> {
  try {
    const res = await query(`SELECT value FROM admin_settings WHERE key = 'scan_schedule'`);
    if (res.rows.length > 0) {
      const val = JSON.parse(res.rows[0].value);
      if (val && val.type && val.type !== 'off') {
        return val as ScanSchedule;
      }
    }
  } catch (err) {
    console.error('[Cron] Failed to read scan_schedule from DB:', err);
  }
  return null;
}

function msUntilNextSchedule(schedule: ScanSchedule): number | null {
  const now = new Date();
  const h = schedule.hour ?? 2;
  const m = schedule.minute ?? 0;

  if (schedule.type === 'daily') {
    const target = new Date();
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
  }

  if (schedule.type === 'weekly') {
    const dayOfWeek = schedule.dayOfWeek ?? 0;
    const target = new Date();
    target.setHours(h, m, 0, 0);
    const currentDay = now.getDay();
    let daysUntil = dayOfWeek - currentDay;
    if (daysUntil < 0 || (daysUntil === 0 && target <= now)) daysUntil += 7;
    target.setDate(target.getDate() + daysUntil);
    return target.getTime() - now.getTime();
  }

  if (schedule.type === 'monthly') {
    const dayOfMonth = Math.max(1, Math.min(28, schedule.dayOfMonth ?? 1));
    const target = new Date();
    target.setHours(h, m, 0, 0);
    target.setDate(dayOfMonth);
    if (target <= now) {
      target.setMonth(target.getMonth() + 1);
      target.setDate(Math.min(dayOfMonth, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
    }
    return target.getTime() - now.getTime();
  }

  return null;
}

async function getScheduleDelayMs(): Promise<{ delayMs: number; label: string } | null> {
  const schedule = await getScanSchedule();
  if (schedule) {
    const delayMs = msUntilNextSchedule(schedule);
    if (delayMs !== null && delayMs > 0) {
      return { delayMs, label: schedule.type };
    }
    return null;
  }
  const intervalMs = await getScanIntervalMs();
  if (intervalMs !== null) {
    return { delayMs: intervalMs, label: `legacy interval (${Math.round(intervalMs / 60000)}min)` };
  }
  return null;
}

async function scheduleNext(): Promise<void> {
  try {
    const result = await getScheduleDelayMs();
    if (!result) {
      console.log('[Cron] No scan schedule configured. Periodic scan is off.');
      return;
    }

    const mins = Math.round(result.delayMs / 60000);
    console.log(`[Cron] Next periodic scan in ~${mins} minutes (${result.label})`);

    setTimeout(async () => {
      try {
        const { ScannerService } = await import('../modules/scanner/scanner.service');
        await ScannerService.scanAllDirectories('');
      } catch (error) {
        console.error('[Cron] Error during periodic scan', error);
      }
      scheduleNext();
    }, result.delayMs);
  } catch (error) {
    console.error('[Cron] Error scheduling periodic scan', error);
    setTimeout(scheduleNext, 60_000);
  }
}

setTimeout(scheduleNext, 10_000);
