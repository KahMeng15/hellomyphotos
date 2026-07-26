import { API_BASE } from '$lib/api/media';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
  const { id } = params;
  try {
    const [mediaRes, personRes] = await Promise.all([
      fetch(`${API_BASE}/api/faces/${id}/media`),
      fetch(`${API_BASE}/api/faces/${id}`)
    ]);
    
    if (!mediaRes.ok) throw new Error('Failed to fetch person media');
    const files = await mediaRes.json();
    
    let personName = 'Unknown Person';
    if (personRes.ok) {
      const personData = await personRes.json();
      personName = personData.name || 'Unknown Person';
    }

    return { id, files, personName };
  } catch (error) {
    console.error(error);
    return { id, files: [], personName: 'Unknown Person' };
  }
};
