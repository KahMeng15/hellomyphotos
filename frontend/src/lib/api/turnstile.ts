import { API_BASE } from './media';

let cachedSitekey: string | null = null;

export async function getTurnstileSitekey(): Promise<string> {
  if (cachedSitekey !== null) return cachedSitekey;
  try {
    const res = await fetch(`${API_BASE}/api/turnstile/sitekey`);
    if (!res.ok) return '';
    const data = await res.json();
    const sitekey: string = data.sitekey || '';
    if (sitekey) cachedSitekey = sitekey;
    return sitekey;
  } catch {
    return '';
  }
}
