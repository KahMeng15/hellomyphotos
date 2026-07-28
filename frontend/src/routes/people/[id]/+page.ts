import { API_BASE } from '$lib/api/media';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
  const { id } = params;
  try {
    const [mediaRes, personRes, coverRes] = await Promise.all([
      fetch(`${API_BASE}/api/faces/${id}/media`),
      fetch(`${API_BASE}/api/faces/${id}`),
      fetch(`${API_BASE}/api/faces/${id}/cover`)
    ]);
    
    if (!mediaRes.ok) throw new Error('Failed to fetch person media');
    const files = await mediaRes.json();
    
    let personName = '';
    if (personRes.ok) {
      const personData = await personRes.json();
      personName = personData.name || '';
    }

    let coverMediaId: string | null = null;
    let coverBoundingBox: any = null;
    let coverImgWidth: number | null = null;
    let coverImgHeight: number | null = null;
    if (coverRes.ok) {
      const coverData = await coverRes.json();
      coverMediaId = coverData.mediaId;
      coverBoundingBox = coverData.boundingBox || null;
      coverImgWidth = coverData.imgWidth || null;
      coverImgHeight = coverData.imgHeight || null;
    }

    return { id, files, personName, coverMediaId, coverBoundingBox, coverImgWidth, coverImgHeight };
  } catch (error) {
    console.error(error);
    return { id, files: [], personName: '', coverMediaId: null, coverBoundingBox: null, coverImgWidth: null, coverImgHeight: null };
  }
};
