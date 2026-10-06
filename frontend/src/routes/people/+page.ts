import { API_BASE } from '$lib/api/media';
import type { PageLoad } from './$types';

export const load: PageLoad = async (event) => {
  const { fetch } = event;
  const signal = (event as any).signal;
  try {
    const res = await fetch(`${API_BASE}/api/faces?page=1&limit=50&sort=named`, { credentials: 'include', signal });
    if (!res.ok) throw new Error('Failed to fetch faces');
    const faces = await res.json();
    return { initialFaces: faces };
  } catch (error) {
    console.error(error);
    return { initialFaces: [] };
  }
};
