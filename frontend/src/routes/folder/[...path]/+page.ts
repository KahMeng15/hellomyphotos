import { fetchFolderContent } from '$lib/api/media';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
  const folderPath = params.path || '';
  try {
    const data = await fetchFolderContent(folderPath, fetch);
    return {
      folderPath,
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
