export interface MediaFile {
  id: string;
  folder_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  blurhash: string | null;
  exif_json?: any;
  aspectRatio?: number;
  folder_cover_id?: string | null;
  bounding_box?: any;
  is_transcoded?: boolean;
  img_width?: number | null;
  img_height?: number | null;
  created_at?: string | null;
  relative_path?: string;
}

export const API_BASE = import.meta.env.VITE_API_URL || '';

export interface DirectoryInfo {
  name: string;
  cover_id: string | null;
  blurhash: string | null;
  cover_bounding_box?: any;
  cover_img_width?: number | null;
  cover_img_height?: number | null;
  path?: string;
  relative_path?: string;
  path_from_share?: string;
}

export async function searchFolderContent(
  folderPath: string,
  queryText: string,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<{ files: MediaFile[], directories: DirectoryInfo[] }> {
  const queryParam = `?q=${encodeURIComponent(queryText)}`;
  const res = await fetchFn(`${API_BASE}/api/folder/${encodeURIComponent(folderPath)}${queryParam}`, { credentials: 'include', signal });
  if (!res.ok) throw new Error('Failed to search folder');
  const data = await res.json();
  return {
    files: data.files || [],
    directories: data.directories || []
  };
}

export async function fetchFolderContent(
  folderPath: string, 
  fetchFn: typeof fetch = fetch, 
  signal?: AbortSignal
): Promise<{ 
  files: MediaFile[], 
  directories: DirectoryInfo[], 
  scanning: boolean, 
  isProcessing: boolean, 
  folderCoverId: string | null, 
  folderCoverBoundingBox: any, 
  folderCoverImgWidth: number | null, 
  folderCoverImgHeight: number | null, 
  folderDescription: string, 
  hostError?: string | null 
}> {
  const res = await fetchFn(`${API_BASE}/api/folder/${encodeURIComponent(folderPath)}`, { credentials: 'include', signal });
  if (!res.ok) throw new Error('Failed to fetch folder');
  const data = await res.json();
  return { 
    files: data.files, 
    directories: data.directories || [], 
    scanning: data.scanning || false, 
    isProcessing: data.isProcessing || false,
    folderCoverId: data.folderCoverId || null,
    folderCoverBoundingBox: data.folderCoverBoundingBox || null,
    folderCoverImgWidth: data.folderCoverImgWidth || null,
    folderCoverImgHeight: data.folderCoverImgHeight || null,
    folderDescription: data.folderDescription || '',
    hostError: data.hostError || null
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

export async function regenerateImages(folderPath: string): Promise<{ count: number }> {
  const res = await fetch(`${API_BASE}/api/folder/regenerate-images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: folderPath }),
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Failed to queue image regeneration');
  return res.json();
}

export async function regenerateVideos(folderPath: string): Promise<{ count: number }> {
  const res = await fetch(`${API_BASE}/api/folder/regenerate-videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: folderPath }),
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Failed to queue video regeneration');
  return res.json();
}

export async function regenerateFolderWatermarks(folderPath: string): Promise<{ success: boolean; purged: number; regenerated: number; filesCount: number }> {
  const res = await fetch(`${API_BASE}/api/folder/regenerate-watermarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: folderPath }),
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Failed to regenerate watermarks');
  return res.json();
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

export async function fetchTimeline(fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<MediaFile[]> {
  const res = await fetchFn(`${API_BASE}/api/timeline`, { credentials: 'include', signal });
  if (!res.ok) throw new Error('Failed to fetch timeline');
  const data = await res.json();
  return data.files || [];
}

export async function fetchMediaFaces(mediaId: string, token?: string): Promise<{person_id: string, bounding_box: any}[]> {
  const res = await fetch(`${API_BASE}/api/media/${mediaId}/faces${token ? `?shareToken=${token}` : ''}`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch faces');
  return res.json();
}

export function getThumbnailUrl(id: string, token?: string): string {
  return `${API_BASE}/api/media/${id}/thumbnail${token ? `?shareToken=${token}` : ''}`;
}

export function getPreviewUrl(id: string, lowBandwidth: boolean = false, token?: string, context?: string): string {
  if (lowBandwidth) return getThumbnailUrl(id, token);
  let url = `${API_BASE}/api/media/${id}/preview`;
  const params = new URLSearchParams();
  if (token) params.set('shareToken', token);
  if (context) params.set('context', context);
  const q = params.toString();
  return q ? `${url}?${q}` : url;
}

export function getStreamUrl(id: string, token?: string): string {
  return `${API_BASE}/api/media/${id}/stream${token ? `?shareToken=${token}` : ''}`;
}

export async function repairMedia(id: string, token?: string): Promise<{ message: string }> {
  const url = `${API_BASE}/api/media/${id}/repair${token ? `?shareToken=${token}` : ''}`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error('Repair request failed');
  return res.json();
}

export async function getMediaQueueStatus(id: string, token?: string): Promise<{ status: string, position?: number }> {
  const url = `${API_BASE}/api/media/${id}/queue-status${token ? `?shareToken=${token}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch queue status');
  return res.json();
}

export function getFolderZipUrl(folderPath: string, token?: string): string {
  return `${API_BASE}/api/zip/${encodeURIComponent(folderPath || '')}${token ? `?shareToken=${token}` : ''}`;
}

export interface ZipPartInfo {
  partIndex: number;
  filename: string;
  sizeBytes: number;
  totalFiles: number;
  status: 'pending' | 'zipping' | 'ready' | 'error';
}

export interface ZipStatusResponse {
  status: 'pending' | 'zipping' | 'ready' | 'error';
  progress: number;
  processedFiles: number;
  totalFiles: number;
  totalBytes: number;
  totalParts: number;
  currentPartIndex: number;
  partSize?: string;
  parts: ZipPartInfo[];
  error?: string;
}

export async function prepareFolderZip(
  folderPath: string, 
  token?: string,
  partSize?: 'single' | '2gb' | '4gb' | '8gb'
): Promise<{ jobId: string; totalFiles: number; totalParts: number; partSize: string; reused?: boolean }> {
  const res = await fetch(`${API_BASE}/api/zip/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath, shareToken: token, partSize }),
    credentials: 'include'
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to prepare ZIP');
  }
  return res.json();
}

export async function getZipJobStatus(jobId: string, token?: string): Promise<ZipStatusResponse> {
  const res = await fetch(`${API_BASE}/api/zip/status/${jobId}${token ? `?shareToken=${token}` : ''}`, {
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Failed to get ZIP status');
  return res.json();
}

export function getZipDownloadUrl(jobId: string, token?: string, partIndex?: number): string {
  const base = partIndex != null
    ? `${API_BASE}/api/zip/download/${jobId}/${partIndex}`
    : `${API_BASE}/api/zip/download/${jobId}`;
  return `${base}${token ? `?shareToken=${token}` : ''}`;
}

export function getFaceThumbnailUrl(personId: string): string {
  return `${API_BASE}/api/faces/${personId}/thumbnail`;
}

export async function renamePerson(personId: string, name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/faces/${personId}/name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Failed to rename person');
}
