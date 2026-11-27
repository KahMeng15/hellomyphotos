const API_BASE = import.meta.env.VITE_API_URL || '';

export interface ShareData {
  id?: string;
  share_token: string;
  allow_download_images: boolean;
  allow_download_folder: boolean;
  allow_favorites?: boolean;
  allow_filter_favorites?: boolean;
  watermark_enabled: boolean;
  watermark_template_id?: string | null;
  watermark_template_name?: string | null;
  expires_at: string | null;
  created_at?: string;
  created_by_name?: string;
  can_manage?: boolean;
  folder_path?: string;
  is_active?: boolean;
  has_password?: boolean;
  label?: string | null;
}

export interface WatermarkTemplateOption {
  id: string;
  name: string;
  description?: string;
  is_default: boolean;
  type: 'text' | 'image';
  allow_hd_download: boolean;
  restricted_tier: '1080p' | '500px';
}

export async function getWatermarkTemplatesForShare(): Promise<{
  templates: WatermarkTemplateOption[];
  globalEnforced: boolean;
  globalTemplateId: string | null;
}> {
  const res = await fetch(`${API_BASE}/api/shares/watermark-templates`);
  if (!res.ok) throw new Error('Failed to fetch watermark templates');
  return res.json();
}

export interface AccessRequest {
  id: string;
  share_token: string;
  folder_path: string;
  name?: string | null;
  email?: string | null;
  note?: string | null;
  status: 'pending' | 'resolved' | string;
  created_at: string;
  is_active?: boolean;
  expires_at?: string | null;
}

export async function createShare(
  folderPath: string,
  mediaId: string | null,
  allowDownloadImages: boolean,
  allowDownloadFolder: boolean,
  watermarkEnabled: boolean,
  expiresAt: string | null,
  watermarkTemplateId?: string | null,
  allowFavorites?: boolean,
  password?: string | null,
  label?: string | null,
  createdAt?: string | null,
  allowFilterFavorites?: boolean
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/shares`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ folderPath, mediaId, allowDownloadImages, allowDownloadFolder, watermarkEnabled, watermarkTemplateId, expiresAt, allowFavorites, allowFilterFavorites, password, label, createdAt })
  });
  if (!res.ok) throw new Error('Failed to create share');
  const data = await res.json();
  return data.shareToken;
}

export async function createPersonShare(
  personId: string,
  allowDownloadImages: boolean,
  allowDownloadFolder: boolean,
  watermarkEnabled: boolean,
  expiresAt: string | null,
  watermarkTemplateId?: string | null,
  allowFavorites?: boolean,
  password?: string | null,
  label?: string | null,
  createdAt?: string | null,
  allowFilterFavorites?: boolean
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/shares`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ personId, allowDownloadImages, allowDownloadFolder, watermarkEnabled, watermarkTemplateId, expiresAt, folderPath: null, mediaId: null, allowFavorites, allowFilterFavorites, password, label, createdAt })
  });
  if (!res.ok) throw new Error('Failed to create person share');
  const data = await res.json();
  return data.shareToken;
}

export async function getActiveShares(folderPath: string): Promise<ShareData[]> {
  const res = await fetch(`${API_BASE}/api/shares/folder/${encodeURIComponent(folderPath)}`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch shares');
  const data = await res.json();
  return data.shares;
}

export async function getActivePersonShares(personId: string): Promise<ShareData[]> {
  const res = await fetch(`${API_BASE}/api/shares/person/${personId}`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch person shares');
  const data = await res.json();
  return data.shares;
}

export interface UpdateSharePayload {
  isActive?: boolean;
  expiresAt?: string | null;
  allowDownloadImages?: boolean;
  allowDownloadFolder?: boolean;
  watermarkEnabled?: boolean;
  watermarkTemplateId?: string | null;
  allowFavorites?: boolean;
  allowFilterFavorites?: boolean;
  password?: string | null;
  removePassword?: boolean;
  label?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
}

export async function updateShare(token: string, updates: UpdateSharePayload): Promise<ShareData> {
  const res = await fetch(`${API_BASE}/api/shares/${token}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(updates)
  });
  if (!res.ok) throw new Error('Failed to update share');
  const data = await res.json();
  return data.share;
}

export async function unlockShare(
  token: string,
  password?: string,
  turnstileToken?: string
): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/api/shares/${token}/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      password,
      'cf-turnstile-response': turnstileToken
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to unlock share');
  }
  return data;
}

export async function revokeShare(token: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/shares/${token}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to revoke share');
}

export async function submitAccessRequest(token: string, payload: { name?: string; email?: string; note?: string; 'cf-turnstile-response'?: string }): Promise<void> {
  const res = await fetch(`${API_BASE}/api/shares/${token}/request-access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to submit access request');
  }
}

export async function getAccessRequests(folderPath: string): Promise<AccessRequest[]> {
  const res = await fetch(`${API_BASE}/api/shares/folder-requests/${encodeURIComponent(folderPath)}`);
  if (!res.ok) throw new Error('Failed to fetch access requests');
  const data = await res.json();
  return data.requests;
}

export async function respondAccessRequest(requestId: string, payload: { action: 'extend' | 'reactivate' | 'new_link'; expiresAt?: string | null; notifyUser: boolean }): Promise<string> {
  const res = await fetch(`${API_BASE}/api/shares/requests/${requestId}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Failed to respond to access request');
  const data = await res.json();
  return data.shareToken;
}

export async function searchShareContent(
  token: string,
  subpath: string,
  queryText: string,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<{ files: any[], directories: any[] }> {
  const pathPart = subpath ? `/${encodeURIComponent(subpath)}` : '';
  const url = `${API_BASE}/api/shares/${token}${pathPart}?q=${encodeURIComponent(queryText)}`;
  const res = await fetchFn(url, { signal });
  if (!res.ok) throw new Error('Failed to search share');
  const data = await res.json();
  return {
    files: data.files || [],
    directories: data.directories || []
  };
}

export async function getAdminLockdown(): Promise<boolean> {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE}/api/admin/shares/lockdown`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Failed to fetch lockdown status');
  const data = await res.json();
  return Boolean(data.lockdown);
}

export async function setAdminLockdown(lockdown: boolean): Promise<boolean> {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE}/api/admin/shares/lockdown`, {
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ lockdown })
  });
  if (!res.ok) throw new Error('Failed to update lockdown status');
  const data = await res.json();
  return Boolean(data.lockdown);
}

export async function getAdminShares(q?: string): Promise<any[]> {
  const token = localStorage.getItem('token');
  const url = q && q.trim() 
    ? `${API_BASE}/api/admin/shares?q=${encodeURIComponent(q.trim())}` 
    : `${API_BASE}/api/admin/shares`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Failed to fetch admin shares');
  const data = await res.json();
  return data.shares || [];
}

export async function updateAdminShare(token: string, payload: {
  is_active?: boolean;
  expires_at?: string | null;
  allow_download_images?: boolean;
  allow_download_folder?: boolean;
  watermark_enabled?: boolean;
  watermark_template_id?: string | null;
  allowFavorites?: boolean;
  allow_favorites?: boolean;
  allowFilterFavorites?: boolean;
  allow_filter_favorites?: boolean;
  password?: string | null;
  remove_password?: boolean;
  label?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
}): Promise<void> {
  const jwt = localStorage.getItem('token');
  const res = await fetch(`${API_BASE}/api/admin/shares/${token}`, {
    method: 'PUT',
    headers: { 
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Failed to update share');
}

export async function deleteAdminShare(token: string): Promise<void> {
  const jwt = localStorage.getItem('token');
  const res = await fetch(`${API_BASE}/api/admin/shares/${token}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${jwt}` }
  });
  if (!res.ok) throw new Error('Failed to delete share');
}

export async function getAdminAccessRequests(status?: string, q?: string): Promise<any[]> {
  const token = localStorage.getItem('token');
  const params = new URLSearchParams();
  if (status && status !== 'all') params.set('status', status);
  if (q && q.trim()) params.set('q', q.trim());
  const url = `${API_BASE}/api/admin/shares/requests${params.toString() ? '?' + params.toString() : ''}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Failed to fetch access requests');
  const data = await res.json();
  return data.requests || [];
}

export async function deleteAdminAccessRequest(id: string): Promise<void> {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE}/api/admin/shares/requests/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Failed to delete access request');
}

