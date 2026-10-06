import { API_BASE } from '$lib/api/media';

export async function load(event: any) {
  const { fetch, signal } = event;
  const res = await fetch(`${API_BASE}/api/faces`, { credentials: 'include', signal });
  if (res.ok) {
    const data = await res.json();
    return { faces: data };
  }
  return { faces: [] };
}
