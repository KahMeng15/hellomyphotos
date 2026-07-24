import { API_BASE } from '$lib/api/media';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
  const { id } = params;
  try {
    const res = await fetch(`${API_BASE}/api/faces/${id}/media`);
    if (!res.ok) throw new Error('Failed to fetch person media');
    const files = await res.json();
    return { id, files };
  } catch (error) {
    console.error(error);
    return { id, files: [] };
  }
};
