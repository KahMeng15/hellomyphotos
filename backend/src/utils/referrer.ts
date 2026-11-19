// Normalizes raw HTTP Referer values into displayable sources and flags
// known referrer-spam / SEO spam so analytics can exclude them.

export const SPAM_DOMAINS = [
  'semalt.com',
  'darodar.com',
  'priceg.com',
  'buttons-for-website.com',
  'social-buttons.com',
  'blackhatworth.com',
  'forum.topic.lt',
  'ilovevitaly.com',
  'o-o-8-o-o.ru',
  'best-seo-offer.com',
  'web-revenue.net',
  'luxurybet.ru',
  'get-free-traffic-now.com',
  'dailyrank.net',
  'onlinefraudservice.com',
  'rank-checker.online',
  '7makemoneyonline.com',
  'how-to-profit-online.com',
  '1pamm.ru',
  'monitor.backlink',
  'sendsay.ru',
  'vodkaved.ru'
];

// Distinctive substrings that reliably indicate SEO/referrer spam.
export const SPAM_SUBSTRINGS = [
  'semalt',
  'darodar',
  'priceg',
  'makemoneyonline',
  'buttons-for-website',
  'rank-checker',
  'get-free-traffic',
  'best-seo',
  'traffic2',
  'vip-best',
  'web-revenue',
  'monetization'
];

export interface NormalizedReferrer {
  name: string;
  spam: boolean;
}

export const ANDROID_PACKAGES: Record<string, string> = {
  'com.whatsapp': 'WhatsApp',
  'com.whatsapp.w4b': 'WhatsApp Business',
  'org.telegram.messenger': 'Telegram',
  'org.telegram.messenger.web': 'Telegram',
  'org.thunderdog.challegram': 'Telegram',
  'com.google.android.gm': 'Gmail',
  'com.google.android.apps.messaging': 'Google Messages',
  'com.twitter.android': 'X (Twitter)',
  'com.instagram.android': 'Instagram',
  'com.facebook.katana': 'Facebook',
  'com.facebook.orca': 'Messenger',
  'com.facebook.lite': 'Facebook Lite',
  'com.linkedin.android': 'LinkedIn',
  'com.slack': 'Slack',
  'com.discord': 'Discord',
  'com.reddit.frontpage': 'Reddit',
  'com.pinterest': 'Pinterest',
  'com.zhiliaoapp.musically': 'TikTok',
  'com.ss.android.ugc.trill': 'TikTok'
};

/**
 * Extracts query parameters from a full URL or relative path safely.
 */
export function parseUrlParams(urlOrPath?: string | null): URLSearchParams | null {
  if (!urlOrPath) return null;
  try {
    if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
      return new URL(urlOrPath).searchParams;
    }
    const qIdx = urlOrPath.indexOf('?');
    if (qIdx >= 0) {
      return new URLSearchParams(urlOrPath.slice(qIdx + 1));
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extracts campaign or referral tags from query parameters.
 * Supports:
 * - utm_source (and utm_medium)
 * - ref, source, ref_src
 * - Click IDs / Share IDs: fbclid (Facebook), igsh (Instagram), ttclid (TikTok),
 *   gclid (Google), twclid (Twitter/X), msclkid (Bing), li_fat_id (LinkedIn), si (YouTube)
 */
export function extractCampaignOrReferralSource(params: URLSearchParams): string | null {
  // 1. UTM parameters (explicit campaign tagging)
  const utmSource = params.get('utm_source')?.trim();
  if (utmSource) {
    const utmMedium = params.get('utm_medium')?.trim();
    if (utmMedium && utmMedium.toLowerCase() !== utmSource.toLowerCase()) {
      return `${utmSource} / ${utmMedium}`;
    }
    return utmSource;
  }

  // 2. Custom referral / source parameters (e.g. ?ref=whatsapp, ?source=telegram)
  const ref = (params.get('ref') || params.get('source'))?.trim();
  if (ref) {
    return ref;
  }

  // 3. Platform-injected share or click IDs (when users share natively or click ads)
  if (params.has('fbclid')) return 'facebook.com';
  if (params.has('igsh')) return 'instagram.com';
  if (params.has('ttclid')) return 'tiktok.com';
  if (params.has('gclid')) return 'google.com';
  if (params.has('twclid') || params.get('ref_src')?.includes('twsrc')) return 'twitter.com';
  if (params.has('li_fat_id')) return 'linkedin.com';
  if (params.has('msclkid')) return 'bing.com';
  if (params.has('si')) return 'youtube.com';

  return null;
}

/**
 * Resolves the primary referrer source at visit logging time.
 */
export function resolveVisitReferrer(
  referrer?: string | null,
  path?: string | null,
  selfHost?: string | null
): string | null {
  // Check path query parameters first (e.g. ?utm_source=... or ?ref=...)
  if (path) {
    const pathParams = parseUrlParams(path);
    if (pathParams) {
      const src = extractCampaignOrReferralSource(pathParams);
      if (src) return src;
    }
  }

  // Check referrer query parameters
  if (referrer) {
    const refParams = parseUrlParams(referrer);
    if (refParams) {
      const src = extractCampaignOrReferralSource(refParams);
      if (src) return src;
    }

    // Android app referral (e.g. android-app://com.whatsapp)
    if (referrer.startsWith('android-app://')) {
      const pkg = referrer.replace(/^android-app:\/\//, '').split('/')[0];
      return ANDROID_PACKAGES[pkg] || `${pkg} (Android)`;
    }

    // Direct / internal check
    let domain: string | null = null;
    try {
      domain = new URL(referrer).hostname.replace(/^www\./, '');
    } catch {
      domain = referrer.slice(0, 120);
    }

    if (selfHost && domain === selfHost.replace(/^www\./, '')) {
      return null;
    }
    return referrer;
  }

  return null;
}

export function normalizeReferrer(
  referrer?: string | null,
  selfHost?: string | null,
  path?: string | null
): NormalizedReferrer {
  // Check path query parameters first
  if (path) {
    const pathParams = parseUrlParams(path);
    if (pathParams) {
      const src = extractCampaignOrReferralSource(pathParams);
      if (src) {
        const lower = src.toLowerCase();
        const spam = SPAM_DOMAINS.includes(lower) || SPAM_SUBSTRINGS.some(s => lower.includes(s));
        return { name: src, spam };
      }
    }
  }

  // Check referrer query parameters or Android app referrer
  if (referrer) {
    const refParams = parseUrlParams(referrer);
    if (refParams) {
      const src = extractCampaignOrReferralSource(refParams);
      if (src) {
        const lower = src.toLowerCase();
        const spam = SPAM_DOMAINS.includes(lower) || SPAM_SUBSTRINGS.some(s => lower.includes(s));
        return { name: src, spam };
      }
    }

    if (referrer.startsWith('android-app://')) {
      const pkg = referrer.replace(/^android-app:\/\//, '').split('/')[0];
      const appName = ANDROID_PACKAGES[pkg] || `${pkg} (Android)`;
      return { name: appName, spam: false };
    }
  }

  if (!referrer) return { name: 'Direct', spam: false };

  let domain: string;
  try {
    domain = new URL(referrer).hostname.replace(/^www\./, '');
  } catch {
    domain = referrer.slice(0, 120);
  }
  if (!domain) return { name: 'Direct', spam: false };

  if (selfHost && domain === selfHost.replace(/^www\./, '')) return { name: 'Direct', spam: false };

  const lower = domain.toLowerCase();
  const spam =
    SPAM_DOMAINS.includes(lower) || SPAM_SUBSTRINGS.some(s => lower.includes(s));
  return { name: domain, spam };
}

// Builds a SQL fragment that excludes rows whose referrer is known spam.
// Returns { sql, params } safe to embed in a WHERE clause.
export function buildSpamFilterSql(column = 'referrer'): { sql: string; params: any[] } {
  const params: any[] = [];
  const conditions: string[] = [];

  for (const domain of SPAM_DOMAINS) {
    params.push(`%${domain}%`);
    conditions.push(`${column} ILIKE $${params.length}`);
  }
  for (const sub of SPAM_SUBSTRINGS) {
    params.push(`%${sub}%`);
    conditions.push(`${column} ILIKE $${params.length}`);
  }

  if (conditions.length === 0) return { sql: '', params: [] };
  return {
    sql: `(${column} IS NULL OR NOT (${conditions.join(' OR ')}))`,
    params
  };
}
