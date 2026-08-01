export interface ParsedUserAgent {
  os: string;
  browser: string;
  deviceType: 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown';
}

// Lightweight, dependency-free User-Agent parser covering the common cases
// seen in a self-hosted photo gallery. Not exhaustive, but accurate for
// mainstream browsers/OSes and tolerant of unknown strings.
export function parseUserAgent(userAgent?: string | null): ParsedUserAgent {
  if (!userAgent) return { os: 'Unknown', browser: 'Unknown', deviceType: 'unknown' };

  const s = userAgent.toLowerCase();

  // --- Device type ---
  let deviceType: ParsedUserAgent['deviceType'] = 'desktop';
  if (/bot|crawler|spider|slurp|bingpreview|facebookexternalhit|whatsapp|curl|wget|postman|python|okhttp|headless|pagespeed|preview/i.test(s)) {
    deviceType = 'bot';
  } else if (/iphone|ipod|android.*mobile|windows phone|blackberry|opera mini|opera mobi|mobile safari/i.test(s)) {
    deviceType = 'mobile';
  } else if (/ipad|tablet|kindle|silk|playbook|android(?!.*mobile)/i.test(s)) {
    deviceType = 'tablet';
  }

  // --- OS ---
  let os = 'Unknown';
  if (/windows nt 10\.0/.test(s)) os = 'Windows';
  else if (/windows nt 6\.[123]/.test(s)) os = 'Windows';
  else if (/windows nt 5\.[12]/.test(s)) os = 'Windows';
  else if (/windows phone/.test(s)) os = 'Windows Phone';
  else if (/android/.test(s)) os = 'Android';
  else if (/iphone|ipad|ipod|mac os x|macintosh/.test(s)) os = deviceType === 'mobile' || deviceType === 'tablet' ? 'iOS' : 'macOS';
  else if (/cros/.test(s)) os = 'Chrome OS';
  else if (/linux/.test(s)) os = 'Linux';
  else if (/freebsd|openbsd|netbsd/.test(s)) os = 'BSD';

  // --- Browser ---
  let browser = 'Unknown';
  if (/edg\//.test(s)) browser = 'Edge';
  else if (/edg[a|ios]?\//.test(s)) browser = 'Edge';
  else if (/opr\/|opera mini|opera\//.test(s)) browser = 'Opera';
  else if (/samsungbrowser/.test(s)) browser = 'Samsung Internet';
  else if (/ucbrowser/.test(s)) browser = 'UC Browser';
  else if (/crios\//.test(s)) browser = 'Chrome (iOS)';
  else if (/fxios\//.test(s)) browser = 'Firefox (iOS)';
  else if (/chrome|crios|chromium|headlesschrome/.test(s)) browser = 'Chrome';
  else if (/firefox|fxios/.test(s)) browser = 'Firefox';
  else if (/safari\//.test(s) && !/chrome|chromium/.test(s)) browser = 'Safari';
  else if (/bingbot|googlebot|duckduckbot|baiduspider|yandex|petalbot|dotbot|ia_archiver|archive\.org_bot/.test(s)) browser = 'Bot/Crawler';
  else if (/outlook|microsoftoffice|office\/|mail\b/.test(s)) browser = 'Email Client';
  else if (/telegrambot|discordbot|slackbot|whatsapp/.test(s)) browser = 'Bot/Messenger';

  return { os, browser, deviceType };
}
