export interface MediaFile {
  id: string;
  folder_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  blurhash: string | null;
}

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export async function fetchFolderContent(folderPath: string): Promise<{ files: MediaFile[], directories: string[], scanning: boolean }> {
  // Use Vite's dev server proxy or direct URL
  const res = await fetch(`${API_BASE}/api/folder/${encodeURIComponent(folderPath)}`);
  if (!res.ok) throw new Error('Failed to fetch folder');
  const data = await res.json();
  return { files: data.files, directories: data.directories || [], scanning: data.scanning || false };
}

export function getThumbnailUrl(id: string): string {
  return `${API_BASE}/api/media/${id}/thumbnail`;
}

export function getPreviewUrl(id: string, lowBandwidth: boolean = false): string {
  return lowBandwidth ? getThumbnailUrl(id) : `${API_BASE}/api/media/${id}/preview`;
}

export function getStreamUrl(id: string): string {
  return `${API_BASE}/api/media/${id}/stream`;
}
