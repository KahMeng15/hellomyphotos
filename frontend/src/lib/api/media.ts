export interface MediaFile {
  id: string;
  folder_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  blurhash: string | null;
  exif_json?: any;
  aspectRatio?: number;
}

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface DirectoryInfo {
  name: string;
  cover_id: string | null;
  blurhash: string | null;
}

export async function fetchFolderContent(folderPath: string): Promise<{ files: MediaFile[], directories: DirectoryInfo[], scanning: boolean, folderCoverId: string | null }> {
  // Use Vite's dev server proxy or direct URL
  const res = await fetch(`${API_BASE}/api/folder/${encodeURIComponent(folderPath)}`);
  if (!res.ok) throw new Error('Failed to fetch folder');
  const data = await res.json();
  return { files: data.files, directories: data.directories || [], scanning: data.scanning || false, folderCoverId: data.folderCoverId || null };
}

export async function setFolderCover(folderPath: string, mediaId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/folder/cover`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ folder: folderPath, mediaId })
  });
  if (!res.ok) throw new Error('Failed to set folder cover');
}

export async function fetchTimeline(): Promise<MediaFile[]> {
  const res = await fetch(`${API_BASE}/api/timeline`);
  if (!res.ok) throw new Error('Failed to fetch timeline');
  const data = await res.json();
  return data.files || [];
}

export async function fetchMediaFaces(mediaId: string): Promise<{person_id: string, bounding_box: any}[]> {
  const res = await fetch(`${API_BASE}/api/media/${mediaId}/faces`);
  if (!res.ok) throw new Error('Failed to fetch faces');
  return res.json();
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
