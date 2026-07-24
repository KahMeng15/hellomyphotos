import { API_BASE } from '$lib/api/media';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
  try {
    const res = await fetch(`${API_BASE}/api/faces`);
    if (!res.ok) throw new Error('Failed to fetch faces');
    const faces = await res.json();
    return { faces };
  } catch (error) {
    console.error(error);
    return { faces: [] };
  }
};
