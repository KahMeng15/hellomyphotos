import { fetchFolderContent } from '$lib/api/media';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
  const folderPath = params.path || '';
  try {
    // SvelteKit custom fetch can be injected if needed, but we use our wrapper
    const data = await fetchFolderContent(folderPath);
    return {
      folderPath,
      files: data.files,
      directories: data.directories,
      scanning: data.scanning
    };
  } catch (error) {
    console.error('Failed to load folder:', error);
    return { folderPath, files: [], directories: [] };
  }
};
