const fs = require('fs');
let content = fs.readFileSync('frontend/src/lib/utils/date.ts', 'utf8');

content = content.replace(/export function formatDate[\s\S]*$/, `export function formatDate(file: { exif_json?: Record<string, unknown> | null; created_at?: string | null }): string {
  const d = getRawDate(file);
  if (!isNaN(d.getTime()) && d.getTime() !== 0) {
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  return 'Unknown Date';
}`);

fs.writeFileSync('frontend/src/lib/utils/date.ts', content, 'utf8');
