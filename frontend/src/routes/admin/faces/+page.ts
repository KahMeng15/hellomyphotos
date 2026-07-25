import { API_BASE } from '$lib/api/media';

export async function load({ fetch }) {
  const res = await fetch(`${API_BASE}/api/faces`, { credentials: 'include' });
  if (res.ok) {
    const data = await res.json();
    return { faces: data };
  }
  return { faces: [] };
}
