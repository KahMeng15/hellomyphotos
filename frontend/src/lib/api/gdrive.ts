import { API_BASE } from './media';

export interface GoogleAccount {
  id: string;
  email: string;
  label: string | null;
  token_expiry: string | null;
  created_at: string;
}

export interface CaesiumConfig {
  enabled: boolean;
  mode?: 'lossy' | 'lossless' | 'max_size';
  quality?: number; // 1-100, default 80
  max_size?: string; // e.g. '1MB', '500KB'
  width?: number | null;
  height?: number | null;
  keep_exif?: boolean; // default true
  keep_dates?: boolean; // default true
}

export interface FolderSyncInfo {
  synced: boolean;
  sync?: {
    id: string;
    account_id: string;
    source_type: 'MEDIA' | 'FASTUP';
    folder_path: string;
    gdrive_folder_id: string;
    gdrive_folder_name: string;
    gdrive_link: string;
    is_active: boolean;
    auto_sync: boolean;
    sync_status: 'IDLE' | 'SYNCING' | 'PAUSED' | 'ERROR';
    last_synced_at: string | null;
    error_message: string | null;
    syncedFileCount?: number;
    totalLocalJpegs?: number;
    caesium_enabled?: boolean;
    caesium_config?: CaesiumConfig | null;
  };
}

export async function getGoogleAuthUrl(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/admin/gdrive/auth-url`, { credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to fetch Google auth URL');
  }
  const data = await res.json();
  return data.url;
}

export async function listGoogleAccounts(): Promise<GoogleAccount[]> {
  const res = await fetch(`${API_BASE}/api/admin/gdrive/accounts`, { credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to list Google accounts');
  }
  const data = await res.json();
  return data.accounts || [];
}

export async function disconnectGoogleAccount(id: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/admin/gdrive/accounts/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to disconnect Google account');
  }
  const data = await res.json();
  return data.success;
}

export async function getFolderGDriveSync(folderPath: string, sourceType: 'MEDIA' | 'FASTUP' = 'MEDIA'): Promise<FolderSyncInfo> {
  const res = await fetch(`${API_BASE}/api/gdrive/sync?folderPath=${encodeURIComponent(folderPath)}&sourceType=${sourceType}`, {
    credentials: 'include'
  });
  if (!res.ok) {
    return { synced: false };
  }
  return res.json();
}

export async function listGoogleDriveFolders(accountId: string, parentId?: string): Promise<Array<{ id: string; name: string; webViewLink?: string }>> {
  const q = parentId ? `&parentId=${encodeURIComponent(parentId)}` : '';
  const res = await fetch(`${API_BASE}/api/gdrive/folders?accountId=${encodeURIComponent(accountId)}${q}`, {
    credentials: 'include'
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to list Google Drive folders');
  }
  const data = await res.json();
  return data.folders || [];
}

export async function getCaesiumSettings(): Promise<{
  isAvailable: boolean;
  version?: string;
  binaryPath?: string;
  defaultConfig: CaesiumConfig;
}> {
  const res = await fetch(`${API_BASE}/api/gdrive/caesium-settings`, {
    credentials: 'include'
  });
  if (!res.ok) {
    return {
      isAvailable: false,
      defaultConfig: {
        enabled: true,
        mode: 'lossy',
        quality: 80,
        max_size: '1MB',
        width: null,
        height: null,
        keep_exif: true,
        keep_dates: true
      }
    };
  }
  return res.json();
}

export async function updateCaesiumDefaultSettings(config: Partial<CaesiumConfig>): Promise<any> {
  const res = await fetch(`${API_BASE}/api/gdrive/caesium-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ config })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update default Caesium settings');
  }
  return res.json();
}

export async function enableFolderGDriveSync(params: {
  accountId: string;
  folderPath: string;
  sourceType?: 'MEDIA' | 'FASTUP';
  folderName?: string;
  existingFolderId?: string;
  caesiumEnabled?: boolean;
  caesiumConfig?: CaesiumConfig;
  saveAsDefault?: boolean;
}): Promise<any> {
  const res = await fetch(`${API_BASE}/api/gdrive/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(params)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to enable Google Drive sync');
  }
  return res.json();
}

export async function updateFolderCaesiumSettings(params: {
  folderPath: string;
  sourceType?: 'MEDIA' | 'FASTUP';
  caesiumEnabled: boolean;
  caesiumConfig: CaesiumConfig;
  saveAsDefault?: boolean;
}): Promise<any> {
  const res = await fetch(`${API_BASE}/api/gdrive/sync/caesium`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(params)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update Caesium settings');
  }
  return res.json();
}

export async function triggerFolderGDriveSync(folderPath: string, sourceType: 'MEDIA' | 'FASTUP' = 'MEDIA'): Promise<any> {
  const res = await fetch(`${API_BASE}/api/gdrive/sync/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ folderPath, sourceType })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to trigger sync');
  }
  return res.json();
}

export async function togglePauseFolderGDriveSync(folderPath: string, sourceType: 'MEDIA' | 'FASTUP' = 'MEDIA', pause: boolean): Promise<any> {
  const res = await fetch(`${API_BASE}/api/gdrive/sync/toggle-pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ folderPath, sourceType, pause })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to toggle sync pause state');
  }
  return res.json();
}

export async function disableFolderGDriveSync(
  folderPath: string, 
  sourceType: 'MEDIA' | 'FASTUP' = 'MEDIA',
  deleteRemote = false
): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/gdrive/sync`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ folderPath, sourceType, deleteRemote })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to remove Google Drive sync');
  }
  const data = await res.json();
  return data.success;
}

export async function getMediaGDriveLink(mediaId: string): Promise<{ synced: boolean; link?: string; gdriveFileId?: string }> {
  const res = await fetch(`${API_BASE}/api/gdrive/media/${mediaId}/link`, {
    credentials: 'include'
  });
  if (!res.ok) {
    return { synced: false };
  }
  return res.json();
}
