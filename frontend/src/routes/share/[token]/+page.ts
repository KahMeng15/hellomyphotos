import { API_BASE } from '$lib/api/media';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
  const { token } = params;
  try {
    const res = await fetch(`${API_BASE}/api/shares/${token}`);
    if (!res.ok) throw new Error('Share not found');
    const data = await res.json();
    return {
      share: data.share,
      files: data.files,
      folderCoverId: data.folderCoverId
    };
  } catch (error) {
    return { error: 'Invalid or expired share link', files: [] };
  }
};
