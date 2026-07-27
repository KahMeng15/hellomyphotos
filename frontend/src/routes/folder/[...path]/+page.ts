import { fetchFolderContent } from '$lib/api/media';
import type { PageLoad } from './$types';

const MEDIA_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif',
  'mp4', 'mov', 'avi', 'mkv', 'webm', '3gp', 'm4v'
]);

export const load: PageLoad = async ({ params, fetch }) => {
  let folderPath = params.path || '';
  let selectedFile: string | undefined;

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

  try {
    const data = await fetchFolderContent(folderPath, fetch);
    return {
      folderPath,
      selectedFile,
      folderCoverId: data.folderCoverId,
      folderDescription: data.folderDescription,
      files: data.files,
      directories: data.directories,
      scanning: data.scanning
    };
  } catch (error) {
    console.error('Failed to load folder:', error);
    return { folderPath, files: [], directories: [] };
  }
};
