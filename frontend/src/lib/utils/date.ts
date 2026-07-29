const DATE_FIELDS = ['dateTimeOriginal', 'DateTimeOriginal', 'createDate', 'CreateDate', 'modifyDate', 'ModifyDate', 'timestamp'];

function normalizeExifDate(val: string): string {
  return val.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
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

export function formatDate(file: { exif_json?: Record<string, unknown> | null; created_at?: string | null }): string {
  for (const key of DATE_FIELDS) {
    const val = file.exif_json?.[key];
    if (val) {
      const d = new Date(normalizeExifDate(String(val)));
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      }
    }
  }
  const d = new Date(file.created_at || 0);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  return 'Unknown Date';
}
