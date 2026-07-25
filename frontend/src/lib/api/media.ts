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

export const API_BASE = import.meta.env.VITE_API_URL || '';

export interface DirectoryInfo {
  name: string;
  cover_id: string | null;
  blurhash: string | null;
}

export async function fetchFolderContent(folderPath: string, fetchFn: typeof fetch = fetch): Promise<{ files: MediaFile[], directories: DirectoryInfo[], scanning: boolean, folderCoverId: string | null, folderDescription: string }> {
  const res = await fetchFn(`${API_BASE}/api/folder/${encodeURIComponent(folderPath)}`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch folder');
  const data = await res.json();
  return { 
    files: data.files, 
    directories: data.directories || [], 
    scanning: data.scanning || false, 
    folderCoverId: data.folderCoverId || null,
    folderDescription: data.folderDescription || '' 
  };
}

export async function setFolderDescription(folderPath: string, description: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/folder/settings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ folder: folderPath, description }),
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Failed to set folder description');
}

export async function rescanFolder(folderPath: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/folder/rescan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: folderPath }),
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Failed to rescan folder');
}

export async function rescanFolderML(folderPath: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/folder/rescan-ml`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: folderPath }),
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Failed to rescan folder ML');
}

export async function setFolderCover(folderPath: string, mediaId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/folder/cover`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ folder: folderPath, mediaId }),
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Failed to set folder cover');
}

export async function fetchTimeline(): Promise<MediaFile[]> {
  const res = await fetch(`${API_BASE}/api/timeline`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch timeline');
  const data = await res.json();
  return data.files || [];
}

export async function fetchMediaFaces(mediaId: string): Promise<{person_id: string, bounding_box: any}[]> {
  const res = await fetch(`${API_BASE}/api/media/${mediaId}/faces`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch faces');
  return res.json();
}

export function getThumbnailUrl(id: string, token?: string): string {
  return `${API_BASE}/api/media/${id}/thumbnail${token ? `?shareToken=${token}` : ''}`;
}

export function getPreviewUrl(id: string, lowBandwidth: boolean = false, token?: string): string {
  if (lowBandwidth) return getThumbnailUrl(id, token);
  return `${API_BASE}/api/media/${id}/preview${token ? `?shareToken=${token}` : ''}`;
}

export function getStreamUrl(id: string, token?: string): string {
  return `${API_BASE}/api/media/${id}/stream${token ? `?shareToken=${token}` : ''}`;
}

export function getFolderZipUrl(folderPath: string, token?: string): string {
  return `${API_BASE}/api/zip/${encodeURIComponent(folderPath || '')}${token ? `?shareToken=${token}` : ''}`;
}
