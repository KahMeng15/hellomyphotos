const API_BASE = 'http://localhost:3000';

export interface ShareData {
  id?: string;
  share_token: string;
  allow_download_images: boolean;
  allow_download_folder: boolean;
  watermark_enabled: boolean;
  expires_at: string | null;
  created_at?: string;
}

export async function createShare(folderPath: string, mediaId: string | null, allowDownloadImages: boolean, allowDownloadFolder: boolean, watermarkEnabled: boolean, expiresAt: string | null): Promise<string> {
  const res = await fetch(`${API_BASE}/api/shares`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath, mediaId, allowDownloadImages, allowDownloadFolder, watermarkEnabled, expiresAt })
  });
  if (!res.ok) throw new Error('Failed to create share');
  const data = await res.json();
  return data.shareToken;
}

export async function getActiveShares(folderPath: string): Promise<ShareData[]> {
  const res = await fetch(`${API_BASE}/api/shares/folder/${encodeURIComponent(folderPath)}`);
  if (!res.ok) throw new Error('Failed to fetch active shares');
  const data = await res.json();
  return data.shares;
}

export async function revokeShare(token: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/shares/${token}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to revoke share');
}
