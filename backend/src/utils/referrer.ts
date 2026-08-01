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

export function normalizeReferrer(referrer?: string | null, selfHost?: string | null): NormalizedReferrer {
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
