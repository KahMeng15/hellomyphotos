const DATE_FIELDS = ['dateTimeOriginal', 'DateTimeOriginal', 'createDate', 'CreateDate', 'modifyDate', 'ModifyDate', 'timestamp'];

export function normalizeExifDate(val: string): string {
  // If formatted as "YYYY:MM:DD HH:MM:SS" -> replace colons in date part with hyphens
  let normalized = val.trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');

  // If ends with Z or .000Z and does not have an explicit +/- timezone offset, strip the trailing Z
  // to prevent treating local camera wall-clock time as UTC, which causes inadvertent timezone/day shifts.
  if (/T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/i.test(normalized) && !/[+-]\d{2}:?\d{2}$/.test(normalized)) {
    normalized = normalized.replace(/Z$/i, '');
  }

  return normalized;
}

export function getSortDate(file: { exif_json?: Record<string, unknown> | null; created_at?: string | null }): number {
  for (const key of DATE_FIELDS) {
    const val = file.exif_json?.[key];
    if (val) {
      const normalized = normalizeExifDate(String(val));
      const time = new Date(normalized).getTime();
      if (!isNaN(time)) return time;
    }
  }
  return new Date(file.created_at || 0).getTime() || 0;
}

export function getRawDate(file: { exif_json?: Record<string, unknown> | null; created_at?: string | null }): Date {
  for (const key of DATE_FIELDS) {
    const val = file.exif_json?.[key];
    if (val) {
      const d = new Date(normalizeExifDate(String(val)));
      if (!isNaN(d.getTime())) return d;
    }
  }
  return new Date(file.created_at || 0);
}

export function formatDate(file: { exif_json?: Record<string, unknown> | null; created_at?: string | null }, serverTimezone?: string): string {
  const d = getRawDate(file);
  if (!isNaN(d.getTime()) && d.getTime() !== 0) {
    const clientLocale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : undefined;
    let clientTimezone: string | undefined;
    try {
      clientTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      clientTimezone = serverTimezone || undefined;
    }

    return d.toLocaleDateString(clientLocale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: clientTimezone || serverTimezone
    });
  }
  return 'Unknown Date';
}

export function formatLocalDateTime(dateInput: Date | string | number, serverTimezone?: string): string {
  let d: Date;
  if (dateInput instanceof Date) {
    d = dateInput;
  } else if (typeof dateInput === 'string') {
    d = new Date(normalizeExifDate(dateInput));
  } else {
    d = new Date(dateInput);
  }

  if (isNaN(d.getTime()) || d.getTime() === 0) return 'Unknown Date';

  // Detect client locale & timezone
  const clientLocale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'default';
  let clientTimezone: string | undefined;
  try {
    clientTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    clientTimezone = serverTimezone || 'UTC';
  }

  return new Intl.DateTimeFormat(clientLocale, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: clientTimezone || serverTimezone
  }).format(d);
}