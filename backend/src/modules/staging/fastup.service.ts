import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { query } from '../../config/db';
import { redis, deleteKeysByPattern } from '../../config/redis';
import { STAGING_ROOT, MEDIA_ROOT, CACHE_ROOT } from '../../utils/mediaPath';
import { sanitizeSessionId } from './staging.service';
import { invalidateShareCache } from '../../utils/auth';
import { thumbnailQueue } from '../../queue/thumbnailQueue';
import { metadataQueue } from '../../queue/metadataQueue';
import { smartSearchQueue } from '../../queue/smartSearchQueue';
import { faceDetectionQueue } from '../../queue/faceDetectionQueue';

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
  userId?: string | null;
}

export interface ReconcileResult {
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
    matchType: 'EXACT_EXIF' | 'APPROX_EXIF' | 'FILENAME_BASE';
    dateTimeOriginal: string | null;
  }>;
}

/**
 * Checks if an IP is a local Docker bridge network, Docker for Mac VM gateway, or loopback.
 */
export function isDockerOrInternalIp(ip: string): boolean {
  if (!ip) return true;
  const clean = ip.replace(/^::ffff:/, '').trim();
  // Docker Desktop Mac gateway (192.168.65.0/24)
  if (clean.startsWith('192.168.65.')) return true;
  // Docker bridge networks (172.16.0.0 - 172.31.255.255)
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(clean)) return true;
  // Localhost
  if (clean === '127.0.0.1' || clean === '::1' || clean === 'localhost') return true;
  return false;
}

/**
 * Checks if an IP is in RFC 1918 private space.
 */
export function isPrivateIp(ip: string): boolean {
  if (!ip) return false;
  const clean = ip.replace(/^::ffff:/, '').trim();
  if (clean.startsWith('10.') || clean.startsWith('192.168.') || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(clean)) {
    return true;
  }
  return false;
}

/**
 * Resolves the client IP accurately:
 * 1. Explicit IP sent by FastUp device (e.g. 10.0.0.44) or x-device-ip header
 * 2. Public IP from Cloudflare/reverse proxy headers (cf-connecting-ip, x-real-ip, x-forwarded-for)
 * 3. Local LAN IP if connecting on private network
 * 4. Filters out Docker internal bridge and Mac VM gateway IPs (192.168.65.x, 172.19.x.x)
 */
export function resolveClientIp(request: any, explicitIp?: string): string {
  if (explicitIp && explicitIp.trim() && !isDockerOrInternalIp(explicitIp.trim())) {
    return explicitIp.trim();
  }

  const deviceHeader = (request?.headers?.['x-device-ip'] || request?.headers?.['x-client-ip'] || request?.headers?.['x-client-local-ip']) as string | undefined;
  if (deviceHeader && deviceHeader.trim() && !isDockerOrInternalIp(deviceHeader.trim())) {
    return deviceHeader.trim();
  }

  const cfIp = request?.headers?.['cf-connecting-ip'] as string | undefined;
  if (cfIp && cfIp.trim() && !isDockerOrInternalIp(cfIp.trim())) {
    return cfIp.trim();
  }

  const realIp = request?.headers?.['x-real-ip'] as string | undefined;
  if (realIp && realIp.trim() && !isDockerOrInternalIp(realIp.trim())) {
    return realIp.trim();
  }

  const xff = request?.headers?.['x-forwarded-for'] as string | undefined;
  if (xff) {
    const parts = xff.split(',').map((s: string) => s.trim()).filter(Boolean);
    const publicIp = parts.find((ip: string) => !isDockerOrInternalIp(ip) && !isPrivateIp(ip));
    if (publicIp) return publicIp;

    const nonDocker = parts.find((ip: string) => !isDockerOrInternalIp(ip));
    if (nonDocker) return nonDocker;
  }

  const reqIp = request?.ip ? request.ip.replace(/^::ffff:/, '') : '';
  if (reqIp && !isDockerOrInternalIp(reqIp)) {
    return reqIp;
  }

  if (deviceHeader && deviceHeader.trim()) {
    return deviceHeader.trim();
  }

  return reqIp || '127.0.0.1';
}

export class FastUpService {
  /**
   * Generates a 6-digit numeric OTP and pre-allocates a photographer session.
   */
  static async createOtp(params: CreateOtpParams) {
    const safeFolderPath = sanitizeSessionId(params.folderPath);
    if (!safeFolderPath) {
      throw new Error('Valid folder path is required');
    }
    const photogName = (params.photographerName || 'Photographer').trim();
    const validityHours = Math.max(1, Math.min(params.validityHours || 24, 720)); // 1 hour to 30 days

    // Generate cryptographically secure 6-digit numeric code
    const randomNum = crypto.randomInt(100000, 999999);
    const otpCode = randomNum.toString();

    // Generate persistent bearer token
    const token = 'ph_tok_' + crypto.randomBytes(24).toString('hex');

    const expiresAt = new Date(Date.now() + validityHours * 3600 * 1000);
    const otpExpiresAt = new Date(Date.now() + 3600 * 1000); // OTP must be claimed within 1 hour

    const predefined = params.settings || {};
    if (!predefined.sessionId) {
      predefined.sessionId = safeFolderPath;
    }

    const res = await query(
      `INSERT INTO photographer_tokens 
       (token, otp_code, otp_expires_at, photographer_name, folder_path, settings_json, is_active, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
       RETURNING id, token, otp_code, photographer_name, folder_path, settings_json, is_active, expires_at, created_at`,
      [
        token,
        otpCode,
        otpExpiresAt,
        photogName,
        safeFolderPath,
        JSON.stringify(predefined),
        expiresAt,
        params.userId || null
      ]
    );

    const row = res.rows[0];
    return {
      id: row.id,
      otpCode: row.otp_code,
      photographerName: row.photographer_name,
      folderPath: row.folder_path,
      expiresAt: row.expires_at,
      settings: row.settings_json
    };
  }

  /**
   * Claims a 6-digit OTP code from FastUp, marking the code consumed
   * and returning the persistent token and predefined settings.
   */
  static async claimOtp(otpCode: string, ipAddress?: string) {
    const cleanCode = (otpCode || '').replace(/\D/g, '').trim();
    if (cleanCode.length !== 6) {
      throw new Error('OTP code must be 6 digits');
    }

    const res = await query(
      `SELECT id, token, photographer_name, folder_path, settings_json, expires_at 
       FROM photographer_tokens 
       WHERE otp_code = $1 AND is_active = true AND (otp_expires_at IS NULL OR otp_expires_at > NOW())
       LIMIT 1`,
      [cleanCode]
    );

    if (res.rows.length === 0) {
      throw new Error('Invalid or expired OTP code');
    }

    const row = res.rows[0];

    // Invalidate the OTP code so it cannot be claimed twice, update last_seen_at
    await query(
      `UPDATE photographer_tokens 
       SET otp_code = NULL, last_seen_at = NOW() 
       WHERE id = $1`,
      [row.id]
    );

    // Log connection / pairing event
    FastUpService.logActivity({
      eventType: 'pairing',
      photographerName: row.photographer_name,
      folderPath: row.folder_path,
      ipAddress: ipAddress || null,
      status: 'success',
      details: { tokenPreview: row.token.slice(0, 10) + '...' }
    }).catch(() => {});

    const settings = row.settings_json || {};

    return {
      token: row.token,
      photographerName: row.photographer_name,
      folderPath: row.folder_path,
      settings: {
        serverUrl: settings.serverUrl || '',
        sessionId: row.folder_path,
        uploadFormat: settings.uploadFormat || 'JPEG_ONLY',
        autoUpload: settings.autoUpload ?? true,
        wifiOnly: settings.wifiOnly ?? false
      }
    };
  }

  /**
   * Lists all photographer tokens and their live status.
   */
  static async listTokens() {
    const res = await query(
      `SELECT id, token, otp_code, photographer_name, folder_path, settings_json, is_active, expires_at, last_seen_at, created_at 
       FROM photographer_tokens 
       ORDER BY created_at DESC 
       LIMIT 100`
    );

    return res.rows.map(row => ({
      id: row.id,
      tokenPreview: row.token.slice(0, 10) + '...' + row.token.slice(-4),
      hasPendingOtp: Boolean(row.otp_code),
      otpCode: row.otp_code,
      photographerName: row.photographer_name,
      folderPath: row.folder_path,
      isActive: row.is_active && (!row.expires_at || new Date(row.expires_at) > new Date()),
      expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
      settings: row.settings_json
    }));
  }

  /**
   * Toggles active/disabled status for a photographer session.
   */
  static async toggleTokenActive(tokenId: string, isActive?: boolean) {
    let res;
    if (typeof isActive === 'boolean') {
      res = await query(
        `UPDATE photographer_tokens SET is_active = $1 WHERE id = $2 RETURNING id, is_active, photographer_name, folder_path`,
        [isActive, tokenId]
      );
    } else {
      res = await query(
        `UPDATE photographer_tokens SET is_active = NOT is_active WHERE id = $1 RETURNING id, is_active, photographer_name, folder_path`,
        [tokenId]
      );
    }

    if (res.rows.length === 0) throw new Error('Photographer token not found');

    const updated = res.rows[0];
    FastUpService.logActivity({
      eventType: 'connection',
      photographerName: updated.photographer_name,
      folderPath: updated.folder_path,
      status: updated.is_active ? 'active' : 'failed',
      details: { action: updated.is_active ? 'session_enabled' : 'session_disabled' }
    }).catch(() => {});

    return {
      id: updated.id,
      isActive: updated.is_active
    };
  }

  /**
   * Generates a new 6-digit OTP code for an existing photographer token session.
   */
  static async refreshOtp(tokenId: string, validityHours: number = 24) {
    const newOtp = String(Math.floor(100000 + Math.random() * 900000));
    const hours = Math.max(1, validityHours || 24);
    const res = await query(
      `UPDATE photographer_tokens 
       SET otp_code = $1, 
           otp_expires_at = NOW() + INTERVAL '1 hour' * $2, 
           is_active = true 
       WHERE id = $3 
       RETURNING id, otp_code, otp_expires_at, photographer_name, folder_path`,
      [newOtp, hours, tokenId]
    );
    if (res.rows.length === 0) throw new Error('Photographer token not found');

    FastUpService.logActivity({
      eventType: 'pairing',
      photographerName: res.rows[0].photographer_name,
      folderPath: res.rows[0].folder_path,
      status: 'active',
      details: { action: 'otp_refreshed', otpPreview: newOtp }
    }).catch(() => {});

    return {
      id: res.rows[0].id,
      otpCode: res.rows[0].otp_code,
      otpExpiresAt: res.rows[0].otp_expires_at
    };
  }

  /**
   * Updates an existing photographer session's settings, name, and folder scope.
   */
  static async updateToken(tokenId: string, updates: {
    photographerName?: string;
    folderPath?: string;
    settings?: any;
    validityHours?: number;
  }) {
    const currentRes = await query(`SELECT * FROM photographer_tokens WHERE id = $1`, [tokenId]);
    if (currentRes.rows.length === 0) throw new Error('Photographer token not found');
    const current = currentRes.rows[0];

    const newName = updates.photographerName?.trim() || current.photographer_name;
    const newFolder = updates.folderPath?.trim() || current.folder_path;
    const mergedSettings = {
      ...(current.settings_json || {}),
      ...(updates.settings || {})
    };

    let newExpiresAt = current.expires_at;
    if (updates.validityHours && updates.validityHours > 0) {
      newExpiresAt = new Date(Date.now() + updates.validityHours * 3600 * 1000).toISOString();
    }

    const res = await query(
      `UPDATE photographer_tokens 
       SET photographer_name = $1, 
           folder_path = $2, 
           settings_json = $3, 
           expires_at = $4 
       WHERE id = $5 
       RETURNING id, photographer_name, folder_path, settings_json, is_active, expires_at`,
      [newName, newFolder, JSON.stringify(mergedSettings), newExpiresAt, tokenId]
    );

    return res.rows[0];
  }

  /**
   * Revokes or deletes a photographer's token immediately.
   */
  static async revokeToken(tokenId: string) {
    const res = await query(
      `DELETE FROM photographer_tokens WHERE id = $1 RETURNING id`,
      [tokenId]
    );
    return res.rows.length > 0;
  }

  /**
   * Logs a FastUp activity event (connection, pairing, or upload).
   */
  static async logActivity(entry: {
    eventType: 'connection' | 'pairing' | 'upload_completed' | 'upload_failed';
    photographerName?: string | null;
    folderPath?: string | null;
    fileName?: string | null;
    fileSizeBytes?: number | null;
    ipAddress?: string | null;
    status: 'success' | 'failed' | 'active' | 'in_progress';
    details?: any;
  }) {
    try {
      await query(
        `INSERT INTO fastup_activity_logs 
         (event_type, photographer_name, folder_path, file_name, file_size_bytes, ip_address, status, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          entry.eventType,
          entry.photographerName || 'Photographer',
          entry.folderPath || null,
          entry.fileName || null,
          entry.fileSizeBytes || null,
          entry.ipAddress || null,
          entry.status,
          JSON.stringify(entry.details || {})
        ]
      );
    } catch (e: any) {
      console.warn('[FastUpService] Failed to log activity:', e.message);
    }
  }

  /**
   * Helper to calculate disk usage of a directory recursively with safety timeout.
   */
  static async getDirectorySizeBytes(dirPath: string): Promise<number> {
    try {
      if (!fs.existsSync(dirPath)) return 0;
      let total = 0;
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dirPath, entry.name);
        try {
          if (entry.isDirectory()) {
            total += await this.getDirectorySizeBytes(full);
          } else if (entry.isFile()) {
            const st = await fs.promises.stat(full);
            total += st.size;
          }
        } catch {}
      }
      return total;
    } catch {
      return 0;
    }
  }

  /**
   * Retrieves comprehensive storage, upload, and queue processing stats.
   * Supports filtering by active session / folder path, and includes a breakdown across all sessions.
   */
  static async getStats(sessionFilter?: string) {
    const cleanSession = sessionFilter?.trim() || null;
    const filterClause = cleanSession ? ` AND (folder_path = $1 OR folder_path LIKE $1 || '/%')` : '';
    const filterParams = cleanSession ? [cleanSession] : [];

    // 1. Storage metrics from DB
    const [stagingDbRes, mediaDbRes] = await Promise.all([
      query(`SELECT COUNT(*)::int as count, COALESCE(SUM(size_bytes), 0)::bigint as total_bytes FROM media_files WHERE is_staged = true${filterClause}`, filterParams),
      query(`SELECT COUNT(*)::int as count, COALESCE(SUM(size_bytes), 0)::bigint as total_bytes FROM media_files WHERE (is_staged = false OR is_staged IS NULL)${filterClause}`, filterParams)
    ]);

    // 2. Physical disk size for staging & cache
    let stagingDiskBytes = Number(stagingDbRes.rows[0].total_bytes);
    let cacheDiskBytes = 0;
    try {
      const c1080 = path.join(CACHE_ROOT, '1080p');
      const c480 = path.join(CACHE_ROOT, '480p');
      const [sz1080, sz480] = await Promise.all([
        this.getDirectorySizeBytes(c1080),
        this.getDirectorySizeBytes(c480)
      ]);
      cacheDiskBytes = sz1080 + sz480;
    } catch {}

    // 3. Upload & Queue Processing counts
    const [
      uploads24hRes,
      metadataRes,
      thumbRes,
      mlRes,
      failedFilesRes,
      connLogsRes,
      transfersRes,
      sessionsRes,
      tokensRes
    ] = await Promise.all([
      query(`SELECT COUNT(*)::int as count FROM media_files WHERE is_staged = true AND created_at > NOW() - INTERVAL '24 hours'${filterClause}`, filterParams),
      query(`SELECT COUNT(*)::int as total, COUNT(exif_json)::int as completed, COUNT(*) FILTER (WHERE failed_attempts > 0 OR processing_error IS NOT NULL)::int as failed FROM media_files WHERE is_staged = true${filterClause}`, filterParams),
      query(`SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE has_1080p AND has_480p)::int as completed, COUNT(*) FILTER (WHERE failed_attempts > 0 OR processing_error IS NOT NULL)::int as failed FROM media_files WHERE is_staged = true AND mime_type LIKE 'image/%'${filterClause}`, filterParams),
      query(`SELECT COUNT(*)::int as total, COUNT(clip_embedding)::int as completed FROM media_files WHERE is_staged = true AND mime_type LIKE 'image/%'${filterClause}`, filterParams),
      query(`SELECT id, folder_path, file_name, mime_type, size_bytes, failed_attempts, processing_error, updated_at 
             FROM media_files 
             WHERE is_staged = true AND (failed_attempts > 0 OR processing_error IS NOT NULL)${filterClause} 
             ORDER BY updated_at DESC 
             LIMIT 50`, filterParams),
      query(`SELECT id, event_type, photographer_name, folder_path, ip_address, status, details, created_at 
             FROM fastup_activity_logs 
             WHERE event_type IN ('connection', 'pairing')${filterClause} 
             ORDER BY created_at DESC 
             LIMIT 20`, filterParams).catch(() => ({ rows: [] })),
      query(`SELECT id, folder_path, file_name, mime_type, size_bytes,
                    has_1080p, has_480p, blurhash, failed_attempts, processing_error, created_at 
             FROM media_files 
             WHERE is_staged = true${filterClause} 
             ORDER BY created_at DESC 
             LIMIT 40`, filterParams).catch(() => ({ rows: [] })),
      query(`
        SELECT 
          folder_path,
          COUNT(*)::int as file_count,
          COALESCE(SUM(size_bytes), 0)::bigint as total_bytes,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int as uploads_24h,
          COUNT(*) FILTER (WHERE has_1080p AND has_480p)::int as completed_thumbs,
          COUNT(*) FILTER (WHERE exif_json IS NOT NULL)::int as completed_exif,
          COUNT(*) FILTER (WHERE clip_embedding IS NOT NULL)::int as completed_ai,
          COUNT(*) FILTER (WHERE failed_attempts > 0 OR processing_error IS NOT NULL)::int as failed_count,
          MAX(created_at) as last_uploaded_at
        FROM media_files
        WHERE is_staged = true
        GROUP BY folder_path
        ORDER BY last_uploaded_at DESC NULLS LAST, file_count DESC
      `).catch(() => ({ rows: [] })),
      query(`SELECT photographer_name, folder_path, is_active, last_seen_at FROM photographer_tokens`).catch(() => ({ rows: [] }))
    ]);

    // BullMQ active counts
    let activeUploads = 0;
    try {
      const [metaCounts, thumbCounts] = await Promise.all([
        metadataQueue.getJobCounts('active', 'waiting'),
        thumbnailQueue.getJobCounts('active', 'waiting')
      ]);
      activeUploads = (metaCounts.active || 0) + (thumbCounts.active || 0);
    } catch {}

    // Build session breakdown map
    const sessionMap = new Map<string, any>();
    for (const r of sessionsRes.rows) {
      sessionMap.set(r.folder_path, {
        folderPath: r.folder_path,
        fileCount: Number(r.file_count || 0),
        sizeBytes: Number(r.total_bytes || 0),
        uploads24h: Number(r.uploads_24h || 0),
        completedThumbs: Number(r.completed_thumbs || 0),
        completedExif: Number(r.completed_exif || 0),
        completedAi: Number(r.completed_ai || 0),
        failedCount: Number(r.failed_count || 0),
        lastUploadedAt: r.last_uploaded_at,
        photographerName: null,
        isActive: false,
        lastSeenAt: null
      });
    }

    for (const t of tokensRes.rows) {
      if (sessionMap.has(t.folder_path)) {
        const item = sessionMap.get(t.folder_path);
        if (!item.photographerName) item.photographerName = t.photographer_name;
        item.isActive = item.isActive || t.is_active;
        if (!item.lastSeenAt || (t.last_seen_at && new Date(t.last_seen_at) > new Date(item.lastSeenAt))) {
          item.lastSeenAt = t.last_seen_at;
        }
      } else {
        sessionMap.set(t.folder_path, {
          folderPath: t.folder_path,
          fileCount: 0,
          sizeBytes: 0,
          uploads24h: 0,
          completedThumbs: 0,
          completedExif: 0,
          completedAi: 0,
          failedCount: 0,
          lastUploadedAt: null,
          photographerName: t.photographer_name,
          isActive: t.is_active,
          lastSeenAt: t.last_seen_at
        });
      }
    }

    const sessions = Array.from(sessionMap.values()).sort((a, b) => {
      if (b.fileCount !== a.fileCount) return b.fileCount - a.fileCount;
      return a.folderPath.localeCompare(b.folderPath);
    });

    return {
      selectedSession: cleanSession,
      sessions,
      storage: {
        staging: {
          fileCount: stagingDbRes.rows[0].count,
          sizeBytes: Number(stagingDbRes.rows[0].total_bytes),
          diskBytes: stagingDiskBytes
        },
        media: {
          fileCount: mediaDbRes.rows[0].count,
          sizeBytes: Number(mediaDbRes.rows[0].total_bytes)
        },
        cache: {
          sizeBytes: cacheDiskBytes
        }
      },
      uploads: {
        totalStaged: stagingDbRes.rows[0].count,
        uploadsLast24h: uploads24hRes.rows[0].count,
        activeProcessing: activeUploads
      },
      pipelines: {
        metadata: {
          total: metadataRes.rows[0].total,
          completed: metadataRes.rows[0].completed,
          failed: metadataRes.rows[0].failed,
          pending: Math.max(0, metadataRes.rows[0].total - metadataRes.rows[0].completed - metadataRes.rows[0].failed)
        },
        thumbnails: {
          total: thumbRes.rows[0].total,
          completed: thumbRes.rows[0].completed,
          failed: thumbRes.rows[0].failed,
          pending: Math.max(0, thumbRes.rows[0].total - thumbRes.rows[0].completed - thumbRes.rows[0].failed)
        },
        mlSmartSearch: {
          total: mlRes.rows[0].total,
          completed: mlRes.rows[0].completed,
          pending: Math.max(0, mlRes.rows[0].total - mlRes.rows[0].completed)
        }
      },
      failedJobs: failedFilesRes.rows.map((r: any) => ({
        id: r.id,
        folderPath: r.folder_path,
        fileName: r.file_name,
        mimeType: r.mime_type,
        sizeBytes: Number(r.size_bytes),
        failedAttempts: r.failed_attempts,
        error: r.processing_error,
        updatedAt: r.updated_at
      })),
      connectionLogs: connLogsRes.rows.map((r: any) => ({
        id: r.id,
        eventType: r.event_type,
        photographerName: r.photographer_name,
        folderPath: r.folder_path,
        ipAddress: r.ip_address,
        status: r.status,
        details: r.details,
        createdAt: r.created_at
      })),
      transferLogs: transfersRes.rows.map((r: any) => {
        let status = 'uploaded';
        let statusLabel = 'Uploaded (Thumbnailing)';
        if (r.failed_attempts > 0 || r.processing_error) {
          status = 'failed';
          statusLabel = r.processing_error || 'Processing Failed';
        } else if (r.has_1080p && r.has_480p) {
          status = 'completed';
          statusLabel = 'Transferred & Processed';
        }

        return {
          id: r.id,
          fileName: r.file_name,
          folderPath: r.folder_path,
          mimeType: r.mime_type,
          sizeBytes: Number(r.size_bytes),
          status,
          statusLabel,
          createdAt: r.created_at
        };
      })
    };
  }

  /**
   * Retrieves the current notice settings for staging / FastUp live folders.
   */
  static async getStagingNotice() {
    try {
      const res = await query(`SELECT value FROM admin_settings WHERE key = 'fastup_staging_notice'`);
      const fallback = {
        enabled: true,
        title: 'Realtime Photo Sync in Progress',
        message: 'Note that the photos in this app are being synced in realtime and are not filtered or edited yet. Please return during a later time for the final images. For any enquiries about these photos, you may contact the photographer.'
      };
      return res.rows.length > 0 && res.rows[0].value ? { ...fallback, ...res.rows[0].value } : fallback;
    } catch {
      return {
        enabled: true,
        title: 'Realtime Photo Sync in Progress',
        message: 'Note that the photos in this app are being synced in realtime and are not filtered or edited yet. Please return during a later time for the final images. For any enquiries about these photos, you may contact the photographer.'
      };
    }
  }

  /**
   * Updates notice settings for staging / FastUp live folders.
   */
  static async updateStagingNotice(settings: { enabled: boolean; title: string; message: string }) {
    const payload = {
      enabled: settings.enabled !== false,
      title: (settings.title || 'Realtime Photo Sync in Progress').trim(),
      message: (settings.message || '').trim()
    };
    await query(`
      INSERT INTO admin_settings (key, value, updated_at)
      VALUES ('fastup_staging_notice', $1::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `, [JSON.stringify(payload)]);
    return payload;
  }

  /**
   * Retry failed media processing jobs.
   */
  static async retryFailedJobs() {
    const failedFiles = await query(
      `SELECT id, folder_path, file_name, mime_type FROM media_files 
       WHERE is_staged = true AND (failed_attempts > 0 OR processing_error IS NOT NULL)`
    );

    await query(
      `UPDATE media_files 
       SET failed_attempts = 0, processing_error = NULL, updated_at = NOW() 
       WHERE is_staged = true AND (failed_attempts > 0 OR processing_error IS NOT NULL)`
    );

    // Re-dispatch to thumbnailQueue and metadataQueue
    for (const f of failedFiles.rows) {
      try {
        await thumbnailQueue.add(`retry_thumb_${f.id}`, { mediaId: f.id });
        await metadataQueue.add(`retry_meta_${f.id}`, { mediaId: f.id });
      } catch {}
    }

    return { retriedCount: failedFiles.rows.length };
  }

  /**
   * Helper to normalize camera capture timestamps down to the second.
   */
  private static extractIsoSecond(exif: any): string | null {
    if (!exif) return null;
    const raw = exif.dateTimeOriginal || exif.DateTimeOriginal || exif.timestamp || exif.createDate || exif.CreateDate;
    if (!raw) return null;
    if (typeof raw === 'string') {
      const match = raw.match(/^(\d{4})[-:](\d{2})[-:](\d{2})[T\s](\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        const [, y, m, d, hh, mm, ss] = match;
        return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
      }
      return raw.slice(0, 19);
    }
    if (raw instanceof Date && !isNaN(raw.getTime())) {
      return raw.toISOString().slice(0, 19);
    }
    return null;
  }

  /**
   * Helper to extract normalized file base (e.g. "DSC01234" from "_DSC01234.ARW" or "DSC01234-Edit.jpg").
   */
  private static extractNormalizedBase(fileName: string): string {
    const base = path.parse(fileName).name.toLowerCase();
    return base
      .replace(/^[_\-]+/, '')
      .replace(/[-_](edit|final|web|export|proof|print|\d+px).*$/i, '')
      .trim();
  }

  /**
   * Reconciles live staging photos with post-event edited photos uploaded to the media volume.
   */
  static async reconcileSession(sessionId: string, targetMediaFolder?: string): Promise<ReconcileResult> {
    const safeSessionId = sanitizeSessionId(sessionId);
    const safeMediaFolder = sanitizeSessionId(targetMediaFolder || safeSessionId);

    if (!safeSessionId) {
      throw new Error('Valid sessionId is required');
    }

    // 1. Fetch all staging photos in sessionId
    const stagingRes = await query(
      `SELECT id, folder_path, file_name, size_bytes, mime_type, exif_json, matched_media_id, created_at 
       FROM media_files 
       WHERE (folder_path = $1 OR folder_path LIKE $2) AND is_staged = true
       ORDER BY file_name ASC`,
      [safeSessionId, `${safeSessionId}/%`]
    );

    // 2. Fetch all media photos in targetMediaFolder
    const mediaRes = await query(
      `SELECT id, folder_path, file_name, size_bytes, mime_type, exif_json, created_at 
       FROM media_files 
       WHERE (folder_path = $1 OR folder_path LIKE $2) AND (is_staged = false OR is_staged IS NULL)
       ORDER BY file_name ASC`,
      [safeMediaFolder, `${safeMediaFolder}/%`]
    );

    const stagingPhotos = stagingRes.rows;
    const mediaPhotos = mediaRes.rows;

    // Index media photos by (IsoSecond + Model) and by NormalizedBase
    const mediaByTimestampModel = new Map<string, any[]>();
    const mediaByNormalizedBase = new Map<string, any[]>();

    for (const m of mediaPhotos) {
      const ts = this.extractIsoSecond(m.exif_json);
      const model = (m.exif_json?.model || '').toLowerCase().trim();
      if (ts) {
        const key = `${ts}_${model}`;
        if (!mediaByTimestampModel.has(key)) mediaByTimestampModel.set(key, []);
        mediaByTimestampModel.get(key)!.push(m);
      }

      const baseName = this.extractNormalizedBase(m.file_name);
      if (baseName) {
        if (!mediaByNormalizedBase.has(baseName)) mediaByNormalizedBase.set(baseName, []);
        mediaByNormalizedBase.get(baseName)!.push(m);
      }
    }

    const matchedPairs: ReconcileResult['matchedPairs'] = [];
    const unmatchedStaging: ReconcileResult['unmatchedStaging'] = [];
    const updateMatchPromises: Promise<any>[] = [];

    for (const s of stagingPhotos) {
      const ts = this.extractIsoSecond(s.exif_json);
      const model = (s.exif_json?.model || '').toLowerCase().trim();
      const baseName = this.extractNormalizedBase(s.file_name);

      let matchedMediaFile: any = null;
      let matchType: 'EXACT_EXIF' | 'APPROX_EXIF' | 'FILENAME_BASE' = 'EXACT_EXIF';

      // 1. Exact EXIF Timestamp + Model Match
      if (ts) {
        const key = `${ts}_${model}`;
        const candidates = mediaByTimestampModel.get(key);
        if (candidates && candidates.length > 0) {
          // If multiple, prefer candidate with matching baseName
          matchedMediaFile = candidates.find(c => this.extractNormalizedBase(c.file_name) === baseName) || candidates[0];
          matchType = 'EXACT_EXIF';
        }
      }

      // 2. Base Filename Match (if timestamp did not match or EXIF missing)
      if (!matchedMediaFile && baseName) {
        const candidates = mediaByNormalizedBase.get(baseName);
        if (candidates && candidates.length > 0) {
          matchedMediaFile = candidates[0];
          matchType = 'FILENAME_BASE';
        }
      }

      if (matchedMediaFile) {
        matchedPairs.push({
          stagingId: s.id,
          stagingFileName: s.file_name,
          mediaId: matchedMediaFile.id,
          mediaFileName: matchedMediaFile.file_name,
          matchType,
          dateTimeOriginal: ts
        });

        if (s.matched_media_id !== matchedMediaFile.id) {
          updateMatchPromises.push(
            query(`UPDATE media_files SET matched_media_id = $1 WHERE id = $2`, [matchedMediaFile.id, s.id]).catch(() => {})
          );
        }
      } else {
        unmatchedStaging.push({
          id: s.id,
          fileName: s.file_name,
          sizeBytes: Number(s.size_bytes),
          mimeType: s.mime_type,
          dateTimeOriginal: ts,
          model: s.exif_json?.model || null,
          createdAt: s.created_at
        });
      }
    }

    // Persist matches asynchronously
    if (updateMatchPromises.length > 0) {
      Promise.all(updateMatchPromises).catch(() => {});
    }

    const stagingCount = stagingPhotos.length;
    const mediaCount = mediaPhotos.length;
    const matchedCount = matchedPairs.length;
    const matchPercentage = stagingCount > 0 ? Number(((matchedCount / stagingCount) * 100).toFixed(1)) : 0;

    return {
      sessionId: safeSessionId,
      targetMediaFolder: safeMediaFolder,
      stagingCount,
      mediaCount,
      matchedCount,
      matchPercentage,
      unmatchedStaging,
      matchedPairs
    };
  }

  /**
   * Relinks a staging session to a different media folder path,
   * atomically adopting all folder_settings (covers, description) and shared_folders links.
   */
  static async relinkFolder(sourceStagingPath: string, targetMediaPath: string) {
    const src = sanitizeSessionId(sourceStagingPath);
    const tgt = sanitizeSessionId(targetMediaPath);

    if (!src || !tgt) {
      throw new Error('Both source staging path and target media path are required');
    }

    // 1. Adopt folder_settings (covers, descriptions, etc.)
    await query(`
      INSERT INTO folder_settings (folder_path, cover_media_id, auto_cover_media_id, description, hide_staging)
      SELECT $2, cover_media_id, auto_cover_media_id, description, hide_staging
      FROM folder_settings WHERE folder_path = $1
      ON CONFLICT (folder_path) DO UPDATE SET
        cover_media_id = COALESCE(folder_settings.cover_media_id, EXCLUDED.cover_media_id),
        description = COALESCE(folder_settings.description, EXCLUDED.description),
        hide_staging = EXCLUDED.hide_staging
    `, [src, tgt]);

    // 2. Adopt / transfer active shares
    await query(`
      UPDATE shared_folders 
      SET folder_path = $2 
      WHERE folder_path = $1 OR folder_path = $3
    `, [src, tgt, `staging/${src}`]);

    // 3. Clear directory and share caches
    invalidateShareCache();
    try {
      await deleteKeysByPattern('folder_dirs_v2:*');
      await deleteKeysByPattern('share:dirs:*');
    } catch {}

    return {
      success: true,
      sourceStagingPath: src,
      targetMediaPath: tgt
    };
  }

  /**
   * Manually toggles whether live staging photos for an event session
   * are hidden from gallery viewers and public shares.
   */
  static async toggleHideStaging(sessionId: string, hide: boolean) {
    const safeId = sanitizeSessionId(sessionId);
    if (!safeId) {
      throw new Error('Valid sessionId is required');
    }

    // Update folder_settings
    await query(`
      INSERT INTO folder_settings (folder_path, hide_staging)
      VALUES ($1, $2)
      ON CONFLICT (folder_path) DO UPDATE SET hide_staging = $2
    `, [safeId, hide]);

    // Update media_files flag
    const res = await query(`
      UPDATE media_files 
      SET is_hidden_staging = $2 
      WHERE (folder_path = $1 OR folder_path LIKE $3) AND is_staged = true
    `, [safeId, hide, `${safeId}/%`]);

    // Clear caches
    invalidateShareCache();
    try {
      await deleteKeysByPattern('folder_dirs_v2:*');
      await deleteKeysByPattern('share:dirs:*');
    } catch {}

    return {
      sessionId: safeId,
      hidden: hide,
      affectedFiles: res.rowCount
    };
  }

  /**
   * Purges the staging volume files and unlinks DB records for a completed session.
   */
  static async purgeStaging(sessionId: string) {
    const safeId = sanitizeSessionId(sessionId);
    if (!safeId) {
      throw new Error('Valid sessionId is required');
    }

    const sessionDir = path.join(STAGING_ROOT, safeId);

    // 1. Get all staging files belonging to this session
    const filesRes = await query(
      `SELECT id, file_name FROM media_files 
       WHERE (folder_path = $1 OR folder_path LIKE $2) AND is_staged = true`,
      [safeId, `${safeId}/%`]
    );

    const deletedCount = filesRes.rows.length;

    // 2. Remove cached thumbnails
    const dir1080 = path.join(CACHE_ROOT, '1080p');
    const dir480 = path.join(CACHE_ROOT, '480p');
    const dirWm = path.join(CACHE_ROOT, 'watermark_previews');

    for (const f of filesRes.rows) {
      const id = f.id;
      try {
        const p1080 = path.join(dir1080, `${id}.webp`);
        if (fs.existsSync(p1080)) await fs.promises.unlink(p1080);
      } catch {}
      try {
        const p480 = path.join(dir480, `${id}.webp`);
        if (fs.existsSync(p480)) await fs.promises.unlink(p480);
      } catch {}
      try {
        if (fs.existsSync(dirWm)) {
          const wmFiles = await fs.promises.readdir(dirWm);
          for (const wmF of wmFiles) {
            if (wmF.startsWith(`${id}_`)) {
              await fs.promises.unlink(path.join(dirWm, wmF)).catch(() => {});
            }
          }
        }
      } catch {}
    }

    // 3. Remove DB records
    await query(
      `DELETE FROM media_files 
       WHERE (folder_path = $1 OR folder_path LIKE $2) AND is_staged = true`,
      [safeId, `${safeId}/%`]
    );

    // 4. Remove physical directory from STAGING_ROOT
    if (fs.existsSync(sessionDir)) {
      await fs.promises.rm(sessionDir, { recursive: true, force: true });
    }

    // 5. Invalidate caches
    invalidateShareCache();
    try {
      await deleteKeysByPattern('folder_dirs_v2:*');
      await deleteKeysByPattern('share:dirs:*');
    } catch {}

    return {
      deletedCount,
      sessionId: safeId
    };
  }
}
