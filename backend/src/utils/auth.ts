import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_please_change';

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  role: 'super_admin' | 'admin' | 'user' | 'viewer';
  folders: string[]; // '*' for all, or specific paths
}

// Add user to FastifyRequest interface
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

import { pool } from '../config/db';

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  const token = request.cookies.token || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null);
  if (!token) {
    return reply.status(401).send({ error: 'Unauthorized: Missing token' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    
    // Fetch fresh user data from DB
    const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [decoded.id]);
    if (rows.length === 0) {
      return reply.status(401).send({ error: 'Unauthorized: User not found' });
    }
    
    const role = rows[0].role;
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

export async function verifyMediaAccess(request: FastifyRequest, reply: FastifyReply, mediaId: string) {
  // 1. Check share token first
  const { shareToken } = request.query as { shareToken?: string };
  
  let mediaFolder = null;
  const mediaResult = await pool.query('SELECT folder_path FROM media_files WHERE id = $1', [mediaId]);
  if (mediaResult.rows.length === 0) {
    reply.status(404).send({ error: 'Media not found' });
    return false; // Not allowed
  }
  mediaFolder = mediaResult.rows[0].folder_path;

  if (shareToken) {
    const shareResult = await pool.query('SELECT folder_path FROM shared_folders WHERE share_token = $1', [shareToken]);
    if (shareResult.rows.length > 0) {
      const shareRoot = shareResult.rows[0].folder_path;
      if (mediaFolder === shareRoot || mediaFolder.startsWith(shareRoot + '/')) {
        return true; // Access granted via share link
      }
    }
  }

  // 2. If no valid share token, fallback to standard user auth
  await requireAuth(request, reply);
  if (reply.sent) return false;

  if (hasFolderAccess(request.user!, mediaFolder)) {
    return true; // Access granted via user auth
  } else {
    reply.status(403).send({ error: 'Forbidden: You do not have access to this media' });
    return false;
  }
}

export async function verifyFolderAccess(request: FastifyRequest, reply: FastifyReply, folderPath: string) {
  // 1. Check share token first
  const { shareToken } = request.query as { shareToken?: string };
  
  if (shareToken) {
    const shareResult = await pool.query('SELECT folder_path, allow_download_folder FROM shared_folders WHERE share_token = $1', [shareToken]);
    if (shareResult.rows.length > 0) {
      const shareRoot = shareResult.rows[0].folder_path || '';
      
      // If we are checking for zip download, enforce allow_download_folder
      if (request.url.includes('/api/zip/')) {
        if (!shareResult.rows[0].allow_download_folder) {
          reply.status(403).send({ error: 'Forbidden: ZIP download not allowed for this share link' });
          return false;
        }
      }

      if (folderPath === shareRoot || folderPath.startsWith(shareRoot + '/')) {
        return true; // Access granted via share link
      }
    }
  }

  // 2. If no valid share token, fallback to standard user auth
  await requireAuth(request, reply);
  if (reply.sent) return false;

  if (hasFolderAccess(request.user!, folderPath)) {
    return true; // Access granted via user auth
  } else {
    reply.status(403).send({ error: 'Forbidden: You do not have access to this folder' });
    return false;
  }
}
