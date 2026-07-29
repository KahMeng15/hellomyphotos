import { API_BASE } from '$lib/api/media';
import type { PageLoad } from './$types';

const MEDIA_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif',
  'mp4', 'mov', 'avi', 'mkv', 'webm', '3gp', 'm4v'
]);

export const load: PageLoad = async ({ params, fetch }) => {
  const { token, path } = params;
  let folderPath = path || '';
  let selectedFile: string | undefined;

  if (folderPath) {
    const lastSlash = folderPath.lastIndexOf('/');
    const lastSegment = lastSlash >= 0 ? folderPath.slice(lastSlash + 1) : folderPath;
    const dot = lastSegment.lastIndexOf('.');
    if (dot > 0) {
      const ext = lastSegment.slice(dot + 1).toLowerCase();
      if (MEDIA_EXTENSIONS.has(ext)) {
        selectedFile = lastSegment;
        folderPath = lastSlash >= 0 ? folderPath.slice(0, lastSlash) : '';
      }
    }
  }

  try {
    const res = await fetch(`${API_BASE}/api/shares/${token}${folderPath ? '/' + encodeURIComponent(folderPath) : ''}`);
    if (!res.ok) throw new Error('Share not found');
    const data = await res.json();
    return {
      share: data.share,
      files: data.files,
      directories: data.directories || [],
      folderCoverId: data.folderCoverId,
      folderDescription: data.folderDescription || '',
      baseFolderPath: data.baseFolderPath || '',
      folderPath: data.folderPath || folderPath,
      selectedFile,
      token,
      person: data.person || null,
      personCoverMediaId: data.personCoverMediaId || null
    };
  } catch (error) {
    return { error: 'Invalid or expired share link', files: [] };
  }
};
