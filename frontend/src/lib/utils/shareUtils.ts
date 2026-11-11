export function formatShareDate(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return 'Never';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return 'Invalid date';

  const day = d.getDate();
  const month = d.toLocaleString('en-US', { month: 'long' });
  const year = d.getFullYear();
  const weekday = d.toLocaleString('en-US', { weekday: 'long' });

  return `${day} ${month} ${year} (${weekday})`;
}

export function isShareExpired(expiresAt: string | Date | null | undefined): boolean {
  if (!expiresAt) return false;
  const target = new Date(expiresAt).getTime();
  return target <= Date.now();
}

/**
 * Returns nearest simple unit:
 * e.g. "1 Year", "2 Years", "1 Month", "1 Day", "1 Hour", "1 Minute"
 */
export function getNearestExpiryDuration(expiresAt: string | Date | null | undefined): string | null {
  if (!expiresAt) return null;
  const target = new Date(expiresAt).getTime();
  const now = Date.now();
  const diffMs = target - now;

  if (diffMs <= 0) return 'Expired';

  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHours = Math.round(diffSec / 3600);
  const diffDays = Math.round(diffSec / 86400);
  const diffMonths = Math.round(diffDays / 30.44);
  const diffYears = Math.round(diffDays / 365.25);

  if (diffYears >= 1) {
    return diffYears === 1 ? '1 Year' : `${diffYears} Years`;
  }
  if (diffMonths >= 1) {
    return diffMonths === 1 ? '1 Month' : `${diffMonths} Months`;
  }
  if (diffDays >= 1) {
    return diffDays === 1 ? '1 Day' : `${diffDays} Days`;
  }
  if (diffHours >= 1) {
    return diffHours === 1 ? '1 Hour' : `${diffHours} Hours`;
  }
  return diffMin <= 1 ? '1 Minute' : `${diffMin} Minutes`;
}
