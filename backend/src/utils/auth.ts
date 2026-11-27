import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { AnalyticsService } from '../modules/analytics/analytics.service';

export const JWT_SECRET = process.env.JWT_SECRET || (
  process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('FATAL: A secure JWT_SECRET environment variable must be configured in production.'); })()
    : 'super_secret_jwt_key_please_change'
);

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  role: 'super_admin' | 'admin' | 'user' | 'viewer';
  folders: string[]; // '*' for all, or specific paths
  tokenVersion?: number;
}

// Add user to FastifyRequest interface
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

import { pool } from '../config/db';
import { isShareLockdownActive } from './lockdown';

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  const token = request.cookies.token || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null);
  if (!token) {
    return reply.status(401).send({ error: 'Unauthorized: Missing token' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    
    // Fetch fresh user data from DB
    const { rows } = await pool.query('SELECT role, email, password_hash, token_version FROM users WHERE id = $1', [decoded.id]);
    if (rows.length === 0) {
      return reply.status(401).send({ error: 'Unauthorized: User not found' });
    }

    const role = rows[0].role;
    const email = rows[0].email;
    const pwdHash = rows[0].password_hash;
    const dbTokenVersion = rows[0].token_version ?? 1;
    const jwtTokenVersion = decoded.tokenVersion ?? 1;

    if (jwtTokenVersion !== dbTokenVersion) {
      return reply.status(401).send({ error: 'Unauthorized: Session invalidated, please log in again' });
    }

    const defaultHash = '$2b$10$6RA2zF7AVoZaXO/Wj126ROvtJnVNecG4dvJRW9Sinw1HHUV1SlWYa';

    // Force default admin to change credentials
    if ((email === 'admin@example.com' || pwdHash === defaultHash) && !request.url.startsWith('/api/admin/users') && request.url !== '/api/auth/me' && request.url !== '/api/auth/logout' && request.url !== '/api/auth/profile' && request.url !== '/api/auth/password') {
      return reply.status(403).send({ error: 'MUST_CHANGE_CREDENTIALS', message: 'You must change the default email and password before continuing.' });
    }
    
    let folders: string[] = [];
    
    if (role === 'admin' || role === 'super_admin') {
      folders = ['*'];
    } else {
      const accessRows = await pool.query('SELECT folder_path FROM user_folder_access WHERE user_id = $1', [decoded.id]);
      folders = accessRows.rows.map(r => r.folder_path);
    }
    
    request.user = {
      ...decoded,
      role,
      folders
    };
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized: Invalid or expired token' });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return;

  if (request.user?.role !== 'admin' && request.user?.role !== 'super_admin') {
    return reply.status(403).send({ error: 'Forbidden: Admin access required' });
  }
}

// Check if user has access to a specific folder
export function hasFolderAccess(user: AuthUser, folderPath: string): boolean {
  if (user.role === 'admin' || user.role === 'super_admin' || user.folders.includes('*')) {
    return true;
  }
  
  // Direct match or child directory
  return user.folders.some(allowedFolder => {
    return folderPath === allowedFolder || folderPath.startsWith(allowedFolder + '/');
  });
}

// Check if user has access to browse this folder (including as an ancestor to an allowed folder)
export function canBrowseFolder(user: AuthUser, folderPath: string): boolean {
  if (user.role === 'admin' || user.role === 'super_admin' || user.folders.includes('*')) {
    return true;
  }
  
  return user.folders.some(allowedFolder => {
    // 1. Direct match or child directory
    if (folderPath === allowedFolder || folderPath.startsWith(allowedFolder + '/')) {
      return true;
    }
    // 2. Ancestor directory
    if (allowedFolder.startsWith(folderPath ? folderPath + '/' : '')) {
      return true;
    }
    return false;
  });
}

interface MediaFolderCacheEntry {
  folder_path: string;
  expiresAt: number;
}
const mediaFolderCache = new Map<string, MediaFolderCacheEntry>();
const MEDIA_FOLDER_TTL_MS = 60_000;

interface ShareTokenCacheEntry {
  data: { folder_path: string | null; media_id: string | null; person_id: string | null; allow_download_folder?: boolean } | null;
  expiresAt: number;
}
const shareTokenCache = new Map<string, ShareTokenCacheEntry>();
const SHARE_TOKEN_TTL_MS = 30_000;

export function invalidateShareCache(shareToken?: string) {
  if (shareToken) {
    shareTokenCache.delete(shareToken);
  } else {
    shareTokenCache.clear();
  }
}

export function invalidateMediaFolderCache(mediaId?: string) {
  if (mediaId) {
    mediaFolderCache.delete(mediaId);
  } else {
    mediaFolderCache.clear();
  }
}

async function getMediaFolder(mediaId: string): Promise<string | null> {
  const now = Date.now();
  const cached = mediaFolderCache.get(mediaId);
  if (cached && cached.expiresAt > now) {
    return cached.folder_path;
  }
  const mediaResult = await pool.query('SELECT folder_path FROM media_files WHERE id = $1', [mediaId]);
  if (mediaResult.rows.length === 0) return null;
  const folder_path = mediaResult.rows[0].folder_path;

  if (mediaFolderCache.size > 10_000) {
    const iter = mediaFolderCache.keys();
    for (let i = 0; i < 2000; i++) {
      const next = iter.next();
      if (next.done) break;
      mediaFolderCache.delete(next.value);
    }
  }
  mediaFolderCache.set(mediaId, { folder_path, expiresAt: now + MEDIA_FOLDER_TTL_MS });
  return folder_path;
}

export function getSharePasswordSig(token: string, passwordHash: string): string {
  return crypto.createHmac('sha256', JWT_SECRET).update(`${token}:${passwordHash}`).digest('hex');
}

export async function getCachedShare(shareToken: string) {
  const now = Date.now();
  const cached = shareTokenCache.get(shareToken);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }
  const shareResult = await pool.query(
    'SELECT folder_path, media_id, person_id, allow_download_folder, password_hash FROM shared_folders WHERE share_token = $1 AND is_active = true AND (expires_at IS NULL OR expires_at > NOW())',
    [shareToken]
  );
  const data = shareResult.rows.length > 0 ? shareResult.rows[0] : null;
  if (shareTokenCache.size > 2000) {
    shareTokenCache.clear();
  }
  shareTokenCache.set(shareToken, { data, expiresAt: now + SHARE_TOKEN_TTL_MS });
  return data;
}

export async function verifyMediaAccess(request: FastifyRequest, reply: FastifyReply, mediaId: string) {
  // 1. Check share token first
  const { shareToken } = request.query as { shareToken?: string };

  const logBlocked = (actionType: string) => {
    AnalyticsService.logVisit({
      mediaId,
      shareToken,
      deviceId: (request as any).deviceId || (request.cookies as any)?.['hmp_device_id'] || null,
      actionType,
      ip: request.ip,
      userAgent: request.headers['user-agent'] as string | undefined,
      referrer: request.headers.referer as string | undefined,
      path: request.url
    });
  };

  const mediaFolder = await getMediaFolder(mediaId);
  if (mediaFolder === null) {
    logBlocked('not_found');
    reply.status(404).send({ error: 'Media not found' });
    return false; // Not allowed
  }

  if (shareToken) {
    if (await isShareLockdownActive()) {
      logBlocked('lockdown_blocked');
    } else {
      const shareRecord = await getCachedShare(shareToken);
      if (shareRecord) {
        if (shareRecord.password_hash) {
          const expectedSig = getSharePasswordSig(shareToken, shareRecord.password_hash);
          if (request.cookies[`sp_${shareToken}`] !== expectedSig) {
            logBlocked('blocked_access');
            reply.status(401).send({ error: 'Password required' });
            return false;
          }
        }
        const { folder_path: shareRoot, media_id: shareMediaId, person_id: sharePersonId } = shareRecord;
        if (shareMediaId && shareMediaId === mediaId) {
          return true;
        }
        if (shareRoot && (mediaFolder === shareRoot || mediaFolder.startsWith(shareRoot + '/'))) {
          return true; // Access granted via folder share link
        }
        if (sharePersonId) {
          const faceRes = await pool.query('SELECT 1 FROM face_embeddings WHERE media_id = $1 AND person_id = $2 LIMIT 1', [mediaId, sharePersonId]);
          if (faceRes.rows.length > 0) {
            return true;
          }
        }
      }
    }
  }

  // 2. If no valid share token, fallback to standard user auth
  await requireAuth(request, reply);
  if (reply.sent) {
    logBlocked('blocked_access');
    return false;
  }

  if (hasFolderAccess(request.user!, mediaFolder)) {
    return true; // Access granted via user auth
  } else {
    logBlocked('blocked_access');
    reply.status(403).send({ error: 'Forbidden: You do not have access to this media' });
    return false;
  }
}

export async function verifyFolderAccess(request: FastifyRequest, reply: FastifyReply, folderPath: string) {
  // 1. Check share token first
  const { shareToken } = request.query as { shareToken?: string };

  const logBlocked = (actionType: string) => {
    AnalyticsService.logVisit({
      shareToken,
      deviceId: (request as any).deviceId || (request.cookies as any)?.['hmp_device_id'] || null,
      actionType,
      ip: request.ip,
      userAgent: request.headers['user-agent'] as string | undefined,
      referrer: request.headers.referer as string | undefined,
      path: request.url
    });
  };

  if (shareToken) {
    if (await isShareLockdownActive()) {
      logBlocked('lockdown_blocked');
    } else {
      const shareRecord = await getCachedShare(shareToken);
      if (shareRecord) {
        if (shareRecord.password_hash) {
          const expectedSig = getSharePasswordSig(shareToken, shareRecord.password_hash);
          if (request.cookies[`sp_${shareToken}`] !== expectedSig) {
            logBlocked('blocked_access');
            reply.status(401).send({ error: 'Password required' });
            return false;
          }
        }
        const shareRoot = shareRecord.folder_path || '';
        
        // If we are checking for zip download, enforce allow_download_folder
        if (request.url.includes('/api/zip/')) {
          if (!shareRecord.allow_download_folder) {
            logBlocked('blocked_access');
            reply.status(403).send({ error: 'Forbidden: ZIP download not allowed for this share link' });
            return false;
          }
        }

        if (folderPath === shareRoot || folderPath.startsWith(shareRoot + '/')) {
          return true; // Access granted via share link
        }
      }
    }
  }

  // 2. If no valid share token, fallback to standard user auth
  await requireAuth(request, reply);
  if (reply.sent) {
    logBlocked('blocked_access');
    return false;
  }

  if (hasFolderAccess(request.user!, folderPath)) {
    return true; // Access granted via user auth
  } else {
    logBlocked('blocked_access');
    reply.status(403).send({ error: 'Forbidden: You do not have access to this folder' });
    return false;
  }
}
