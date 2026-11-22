import { API_BASE } from './media';

export interface PredefinedSettings {
  serverUrl?: string;
  sessionId?: string;
  uploadFormat?: 'JPEG_ONLY' | 'RAW_ONLY' | 'RAW_PLUS_JPEG';
  autoUpload?: boolean;
  wifiOnly?: boolean;
}

export interface CreateOtpParams {
  photographerName: string;
  folderPath: string;
  validityHours?: number;
  settings?: PredefinedSettings;
}

export interface PhotographerToken {
  id: string;
  tokenPreview: string;
  hasPendingOtp: boolean;
  otpCode: string | null;
  photographerName: string;
  folderPath: string;
  isActive: boolean;
  expiresAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  settings: PredefinedSettings;
}

export interface SessionStat {
  folderPath: string;
  fileCount: number;
  sizeBytes: number;
  uploads24h: number;
  completedThumbs: number;
  completedExif: number;
  completedAi: number;
  failedCount: number;
  lastUploadedAt: string | null;
  photographerName?: string | null;
  isActive?: boolean;
  lastSeenAt?: string | null;
}

export interface FastUpStats {
  selectedSession?: string | null;
  sessions?: SessionStat[];
  storage: {
    staging: { fileCount: number; sizeBytes: number; diskBytes: number };
    media: { fileCount: number; sizeBytes: number };
    cache: { sizeBytes: number };
  };
  uploads: {
    totalStaged: number;
    uploadsLast24h: number;
    activeProcessing: number;
  };
  pipelines: {
    metadata: { total: number; completed: number; failed: number; pending: number };
    thumbnails: { total: number; completed: number; failed: number; pending: number };
    mlSmartSearch: { total: number; completed: number; pending: number };
  };
  failedJobs: Array<{
    id: string;
    folderPath: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    failedAttempts: number;
    error: string | null;
    updatedAt: string;
  }>;
  connectionLogs?: Array<{
    id: string;
    eventType: string;
    photographerName: string;
    folderPath?: string;
    ipAddress?: string;
    status: string;
    details?: any;
    createdAt: string;
  }>;
  transferLogs?: Array<{
    id: string;
    fileName: string;
    folderPath: string;
    mimeType: string;
    sizeBytes: number;
    status: string;
    statusLabel: string;
    createdAt: string;
  }>;
}

export interface ReconcileData {
  sessionId: string;
  targetMediaFolder: string;
  stagingCount: number;
  mediaCount: number;
  matchedCount: number;
  matchPercentage: number;
  unmatchedStaging: Array<{
    id: string;
    fileName: string;
    sizeBytes: number;
    mimeType: string;
    dateTimeOriginal: string | null;
    model: string | null;
    createdAt: string;
  }>;
  matchedPairs: Array<{
    stagingId: string;
    stagingFileName: string;
    mediaId: string;
    mediaFileName: string;
    matchType: string;
    dateTimeOriginal: string | null;
  }>;
}

export async function createPhotographerOtp(params: CreateOtpParams) {
  const res = await fetch(`${API_BASE}/api/admin/fastup/otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(params)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create OTP');
  return data;
}

export async function fetchPhotographerTokens(): Promise<PhotographerToken[]> {
  const res = await fetch(`${API_BASE}/api/admin/fastup/tokens`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch photographer tokens');
  return res.json();
}

export async function revokePhotographerToken(id: string) {
  const res = await fetch(`${API_BASE}/api/admin/fastup/tokens/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Failed to revoke token');
  return res.json();
}

export async function togglePhotographerTokenActive(id: string, isActive?: boolean): Promise<{ id: string; isActive: boolean }> {
  const res = await fetch(`${API_BASE}/api/admin/fastup/tokens/${id}/toggle-active`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ isActive })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to toggle token active state');
  return data;
}

export async function refreshPhotographerOtp(id: string, validityHours: number = 24): Promise<{ id: string; otpCode: string; otpExpiresAt: string }> {
  const res = await fetch(`${API_BASE}/api/admin/fastup/tokens/${id}/refresh-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ validityHours })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to refresh OTP');
  return data;
}

export async function updatePhotographerToken(id: string, params: {
  photographerName?: string;
  folderPath?: string;
  settings?: PredefinedSettings;
  validityHours?: number;
}): Promise<any> {
  const res = await fetch(`${API_BASE}/api/admin/fastup/tokens/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(params)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update photographer session');
  return data;
}

export async function fetchFastUpStats(sessionId?: string): Promise<FastUpStats> {
  const p = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  const res = await fetch(`${API_BASE}/api/admin/fastup/stats${p}`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch FastUp stats');
  return res.json();
}

export async function retryFastUpFailedJobs() {
  const res = await fetch(`${API_BASE}/api/admin/fastup/retry-failed`, {
    method: 'POST',
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Failed to retry failed jobs');
  return res.json();
}

export async function reconcileStagingSession(sessionId: string, mediaFolder?: string): Promise<ReconcileData> {
  const p = new URLSearchParams({ sessionId });
  if (mediaFolder) p.set('mediaFolder', mediaFolder);
  const res = await fetch(`${API_BASE}/api/admin/fastup/reconcile?${p.toString()}`, { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to reconcile session');
  return data;
}

export async function relinkStagingFolder(sourceStagingPath: string, targetMediaPath: string) {
  const res = await fetch(`${API_BASE}/api/admin/fastup/relink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ sourceStagingPath, targetMediaPath })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to relink folder');
  return data;
}

export async function toggleHideStagingSession(sessionId: string, hide: boolean) {
  const res = await fetch(`${API_BASE}/api/admin/fastup/sessions/${encodeURIComponent(sessionId)}/hide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ hide })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to toggle staging visibility');
  return data;
}

export async function purgeStagingSession(sessionId: string) {
  const res = await fetch(`${API_BASE}/api/admin/fastup/sessions/${encodeURIComponent(sessionId)}/purge`, {
    method: 'DELETE',
    credentials: 'include'
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to purge staging volume');
  return data;
}

export interface FastUpNoticeSettings {
  enabled: boolean;
  title: string;
  message: string;
}

export async function fetchFastUpNotice(): Promise<FastUpNoticeSettings> {
  const res = await fetch(`${API_BASE}/api/admin/fastup/notice`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch staging notice settings');
  return res.json();
}

export async function updateFastUpNotice(settings: FastUpNoticeSettings): Promise<{ success: boolean; notice: FastUpNoticeSettings }> {
  const res = await fetch(`${API_BASE}/api/admin/fastup/notice`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(settings)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update staging notice settings');
  return data;
}
