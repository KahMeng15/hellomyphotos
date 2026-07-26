import { API_BASE } from '$lib/api/media';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ url, fetch }) => {
  const q = url.searchParams.get('q') || '';
  if (!q) {
    return { q, results: [] };
  }
  try {
    const res = await fetch(`${API_BASE}/api/media/search?q=${encodeURIComponent(q)}&limit=50`);
    if (!res.ok) throw new Error('Search failed');
    const results = await res.json();
    return { q, results };
  } catch (e) {
    console.error(e);
    return { q, results: [] };
  }
};
