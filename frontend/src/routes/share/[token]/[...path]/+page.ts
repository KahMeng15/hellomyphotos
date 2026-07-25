import { API_BASE } from '$lib/api/media';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
  const { token, path } = params;
  try {
    const res = await fetch(`${API_BASE}/api/shares/${token}${path ? '/' + encodeURIComponent(path) : ''}`);
    if (!res.ok) throw new Error('Share not found');
    const data = await res.json();
    return {
      share: data.share,
      files: data.files,
      directories: data.directories || [],
      folderCoverId: data.folderCoverId,
      folderDescription: data.folderDescription || '',
      baseFolderPath: data.baseFolderPath || '',
      folderPath: data.folderPath || ''
    };
  } catch (error) {
    return { error: 'Invalid or expired share link', files: [] };
  }
};
