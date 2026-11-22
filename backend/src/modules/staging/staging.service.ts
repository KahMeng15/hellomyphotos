import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { query } from '../../config/db';
import { redis, deleteKeysByPattern } from '../../config/redis';
import { STAGING_ROOT, CACHE_ROOT, MEDIA_ROOT, resolveMediaFullPath } from '../../utils/mediaPath';
import { dispatchMediaFile } from '../../queue/dispatch';
import { thumbnailQueue } from '../../queue/thumbnailQueue';
import { invalidateShareCache } from '../../utils/auth';
import { MediaService } from '../media/media.service';

const RAW_EXTENSIONS = new Set([
  '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.srf', '.sr2',
  '.dng', '.raf', '.rw2', '.orf', '.pef', '.raw'
]);

export function isRawFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return RAW_EXTENSIONS.has(ext);
}

export function sanitizeSessionId(sessionId: string): string {
  if (!sessionId) return '';
  return sessionId
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map(seg => seg.trim())
    .filter(seg => seg.length > 0 && seg !== '.' && seg !== '..')
    .map(seg => seg
      .replace(/\.{2,}/g, '_')
      .replace(/[^a-zA-Z0-9_\-.]/g, '_')
      .replace(/^\.+/, '')
      .replace(/^_+|_+$/g, '')
    )
    .filter(seg => seg.length > 0)
    .join('/');
}

export function getMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.heic':
      return 'image/heic';
    case '.heif':
      return 'image/heif';
    case '.cr2':
      return 'image/x-canon-cr2';
    case '.cr3':
      return 'image/x-canon-cr3';
    case '.nef':
    case '.nrw':
      return 'image/x-nikon-nef';
    case '.arw':
    case '.srf':
    case '.sr2':
      return 'image/x-sony-arw';
    case '.dng':
      return 'image/x-adobe-dng';
    case '.raf':
      return 'image/x-fuji-raf';
    case '.rw2':
      return 'image/x-panasonic-rw2';
    case '.orf':
      return 'image/x-olympus-orf';
    case '.pef':
      return 'image/x-pentax-pef';
    case '.mp4':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    default:
      return 'image/jpeg';
  }
}

export interface StagingUploadResult {
  id: string;
  fileName: string;
  sessionId: string;
  folderPath: string;
  sizeBytes: number;
  mimeType: string;
  width?: number | null;
  height?: number | null;
}

export interface StagingSessionShare {
  id: string;
  shareToken: string;
  shareUrl: string;
  isActive: boolean;
  expiresAt: string | null;
  allowDownloadImages: boolean;
  allowDownloadFolder: boolean;
  watermarkEnabled: boolean;
  createdAt: string;
}

export interface StagingSessionSummary {
  sessionId: string;
  folderPath: string;
  photoCount: number;
  sizeBytes: number;
  createdAt: string;
  lastModifiedAt: string;
  shares: StagingSessionShare[];
}

export class StagingService {
  /**
   * Save an uploaded file to /app/staging/<sessionId>/<filename>
   * and index it in media_files.
   */
  static async saveUploadedFile(
    sessionId: string,
    rawFileName: string,
    fileStreamOrBuffer: NodeJS.ReadableStream | Buffer,
    detectedMimeType?: string
  ): Promise<StagingUploadResult> {
    const safeSessionId = sanitizeSessionId(sessionId);
    if (!safeSessionId) {
      throw new Error('Invalid or missing sessionId');
    }

    const safeFileName = path.basename(rawFileName).replace(/[^a-zA-Z0-9_\-. ]/g, '_');
    if (!safeFileName) {
      throw new Error('Invalid filename');
    }

    const sessionDir = path.join(STAGING_ROOT, safeSessionId);
    await fs.promises.mkdir(sessionDir, { recursive: true });

    const targetFilePath = path.join(sessionDir, safeFileName);

    // Save to disk
    if (Buffer.isBuffer(fileStreamOrBuffer)) {
      await fs.promises.writeFile(targetFilePath, fileStreamOrBuffer);
    } else {
      const writeStream = fs.createWriteStream(targetFilePath);
      await pipeline(fileStreamOrBuffer, writeStream);
    }

    const stat = await fs.promises.stat(targetFilePath);
    const mimeType = detectedMimeType && detectedMimeType !== 'application/octet-stream'
      ? detectedMimeType
      : getMimeType(safeFileName);

    const inoPart = stat.ino ? `ino-${stat.ino}-` : '';
    const fileIdentifier = `${inoPart}sz-${stat.size}-mt-${Math.floor(stat.mtimeMs)}`;
    // Unified overlay: store folderPath directly as the session path without 'staging/' prefix
    const folderPath = safeSessionId;

    let exifJson: any = null;
    let width: number | null = null;
    let height: number | null = null;

    let fileHandle: fs.promises.FileHandle | null = null;
    try {
      fileHandle = await fs.promises.open(targetFilePath, 'r');
      const headerBuffer = Buffer.alloc(131072);
      const { bytesRead } = await fileHandle.read(headerBuffer, 0, headerBuffer.length, 0);
      await fileHandle.close();
      fileHandle = null;

      const exifrModule = await import('exifr');
      const exifr = exifrModule.default || exifrModule;
      exifJson = await exifr.parse(headerBuffer.subarray(0, bytesRead), {
        tiff: true,
        exif: true,
        gps: true,
        translateKeys: true,
        reviveValues: true
      }).catch(() => null);

      if (exifJson) {
        width = exifJson.ImageWidth || exifJson.ExifImageWidth || exifJson.width || null;
        height = exifJson.ImageHeight || exifJson.ExifImageHeight || exifJson.height || null;
      }
    } catch {
      // Non-critical EXIF extraction failure
    } finally {
      if (fileHandle) {
        try { await fileHandle.close(); } catch {}
      }
    }

    if (!width || !height) {
      try {
        const sharpModule = await import('sharp');
        const sharp = sharpModule.default || sharpModule;
        const meta = await sharp(targetFilePath).metadata();
        width = meta.width || null;
        height = meta.height || null;
      } catch {}
    }

    // Upsert into media_files
    let mediaId: string;
    const existingRow = await query(
      `SELECT id FROM media_files WHERE folder_path = $1 AND file_name = $2`,
      [folderPath, safeFileName]
    );

    if (existingRow.rows.length > 0) {
      mediaId = existingRow.rows[0].id;
      await query(
        `UPDATE media_files 
         SET size_bytes = $1, mime_type = $2, file_identifier = $3, exif_json = COALESCE($4, exif_json),
             img_width = COALESCE($5, img_width), img_height = COALESCE($6, img_height),
             has_1080p = false, has_480p = false, is_staged = true, updated_at = NOW() 
         WHERE id = $7`,
        [stat.size, mimeType, fileIdentifier, exifJson ? JSON.stringify(exifJson) : null, width, height, mediaId]
      );
    } else {
      const insertRes = await query(
        `INSERT INTO media_files 
         (folder_path, file_name, mime_type, size_bytes, file_identifier, exif_json, img_width, img_height, is_staged) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true) 
         RETURNING id`,
        [folderPath, safeFileName, mimeType, stat.size, fileIdentifier, exifJson ? JSON.stringify(exifJson) : null, width, height]
      );
      mediaId = insertRes.rows[0].id;
    }

    // Ensure folder_settings entry exists for this folder so it appears in web gallery immediately
    await query(`
      INSERT INTO folder_settings (folder_path)
      VALUES ($1)
      ON CONFLICT (folder_path) DO NOTHING
    `, [folderPath]).catch(() => {});

    // Invalidate directory cache
    await deleteKeysByPattern('folder_dirs_v2:*').catch(() => {});

    // Dispatch background processing to BullMQ workers
    const jobData = {
      mediaId,
      fullPath: targetFilePath,
      mimeType
    };

    dispatchMediaFile(jobData).catch(err => {
      console.warn(`[Staging] BullMQ dispatch warning for ${safeFileName}:`, err.message);
    });

    // Also trigger thumbnail generation immediately as fallback if running without worker
    if (process.env.DISABLE_WORKER === 'true' && !process.env.IS_WORKER) {
      MediaService.processImage(mediaId, targetFilePath).catch(() => {});
    }

    // Schedule server-side burst evaluation and curation
    this.scheduleBurstClustering(folderPath);

    return {
      id: mediaId,
      fileName: safeFileName,
      sessionId: safeSessionId,
      folderPath,
      sizeBytes: stat.size,
      mimeType,
      width,
      height
    };
  }

  /**
   * Generate an on-demand public share link for a staging session.
   */
  static async createShare(
    sessionId: string,
    options: {
      allowDownloadImages?: boolean;
      allowDownloadFolder?: boolean;
      watermarkEnabled?: boolean;
      watermarkTemplateId?: string | null;
      expiresAt?: string | null;
      createdBy?: string;
      allowViewModeToggle?: boolean;
      showHiddenAlternates?: boolean;
      allowHeroSelection?: boolean;
      defaultStagingView?: string;
    } = {}
  ): Promise<{ shareToken: string; shareUrl: string; folderPath: string; sessionId: string; expiresAt: string | null }> {
    const safeSessionId = sanitizeSessionId(sessionId);
    if (!safeSessionId) {
      throw new Error('Invalid or missing sessionId');
    }

    const folderPath = safeSessionId;
    const sessionDir = path.join(STAGING_ROOT, safeSessionId);

    // Verify session folder or media exists (check both unified path and legacy staging/ prefix)
    const countRes = await query(
      `SELECT COUNT(*)::int as count FROM media_files WHERE folder_path = $1 OR folder_path = $2`,
      [folderPath, `staging/${safeSessionId}`]
    );
    const photoCount = countRes.rows[0]?.count || 0;

    if (photoCount === 0 && !fs.existsSync(sessionDir)) {
      throw new Error(`Staging session '${safeSessionId}' not found or has no photos`);
    }

    // Check if an active share link already exists
    const existingShare = await query(
      `SELECT id, share_token, expires_at 
       FROM shared_folders 
       WHERE (folder_path = $1 OR folder_path = $2) AND is_active = true AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC LIMIT 1`,
      [folderPath, `staging/${safeSessionId}`]
    );

    let shareToken: string;
    let finalExpiresAt: string | null = options.expiresAt || null;

    const allowViewModeToggle = options.allowViewModeToggle ?? true;
    const showHiddenAlternates = options.showHiddenAlternates ?? true;
    const allowHeroSelection = options.allowHeroSelection ?? false;
    const defaultStagingView = options.defaultStagingView || 'curated';

    if (existingShare.rows.length > 0 && !options.expiresAt && !options.watermarkTemplateId) {
      shareToken = existingShare.rows[0].share_token;
      finalExpiresAt = existingShare.rows[0].expires_at;

      await query(
        `UPDATE shared_folders 
         SET allow_view_mode_toggle = COALESCE($1, allow_view_mode_toggle),
             show_hidden_alternates = COALESCE($2, show_hidden_alternates),
             allow_hero_selection = COALESCE($3, allow_hero_selection),
             default_staging_view = COALESCE($4, default_staging_view)
         WHERE id = $5`,
        [options.allowViewModeToggle, options.showHiddenAlternates, options.allowHeroSelection, options.defaultStagingView, existingShare.rows[0].id]
      );
    } else {
      shareToken = crypto.randomBytes(16).toString('base64url');
      const allowImages = options.allowDownloadImages ?? true;
      const allowFolder = options.allowDownloadFolder ?? true;
      const watermark = options.watermarkEnabled ?? Boolean(options.watermarkTemplateId);

      // Resolve user id if not provided
      let createdBy = options.createdBy || null;
      if (!createdBy) {
        const adminRes = await query(`SELECT id FROM users WHERE role IN ('admin', 'super_admin') LIMIT 1`);
        if (adminRes.rows.length > 0) createdBy = adminRes.rows[0].id;
      }

      await query(
        `INSERT INTO shared_folders 
         (folder_path, share_token, allow_download_images, allow_download_folder, watermark_enabled, watermark_template_id, expires_at, created_by, is_active, allow_view_mode_toggle, show_hidden_alternates, allow_hero_selection, default_staging_view)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $11, $12)`,
        [folderPath, shareToken, allowImages, allowFolder, watermark, options.watermarkTemplateId || null, finalExpiresAt, createdBy, allowViewModeToggle, showHiddenAlternates, allowHeroSelection, defaultStagingView]
      );

      invalidateShareCache(shareToken);
    }

    // Prioritize high-priority thumbnail generation for any pending photos in this session
    setImmediate(async () => {
      try {
        const pendingFiles = await query(
          `SELECT id, file_name, mime_type, folder_path 
           FROM media_files 
           WHERE folder_path = $1 AND (has_480p = false OR has_1080p = false)`,
          [folderPath]
        );
        for (const f of pendingFiles.rows) {
          const fullPath = resolveMediaFullPath(f.folder_path, f.file_name);
          if (f.mime_type.startsWith('image/')) {
            await thumbnailQueue.add(
              'generate-thumbnail',
              { mediaId: f.id, fullPath, mimeType: f.mime_type, skipCascade: true },
              { priority: 1 }
            ).catch(() => {});
          }
        }
      } catch (err: any) {
        console.warn('[Staging] Failed to prioritize session thumbnails:', err.message);
      }
    });

    const appDomain = (process.env.APP_DOMAIN || '').replace(/\/+$/, '');
    const shareUrl = appDomain ? `${appDomain}/share/${shareToken}` : `/share/${shareToken}`;

    return {
      shareToken,
      shareUrl,
      folderPath,
      sessionId: safeSessionId,
      expiresAt: finalExpiresAt
    };
  }

  /**
   * Returns all directory paths across media_files, MEDIA_ROOT, and STAGING_ROOT.
   */
  static async listFolders(): Promise<string[]> {
    const foldersSet = new Set<string>();

    // 1. Fetch real existing folders from media_files, folder_settings, and photographer_tokens
    try {
      const dbFolders = await query(`
        SELECT DISTINCT folder_path FROM (
          SELECT folder_path FROM media_files WHERE folder_path != '' AND folder_path IS NOT NULL
          UNION
          SELECT folder_path FROM folder_settings WHERE folder_path != '' AND folder_path IS NOT NULL
          UNION
          SELECT folder_path FROM photographer_tokens WHERE folder_path != '' AND folder_path IS NOT NULL
        ) sub
      `);
      for (const row of dbFolders.rows) {
        if (row.folder_path) {
          const raw = String(row.folder_path).trim();
          const clean = raw.replace(/^staging\//, '').trim();
          if (clean) foldersSet.add(clean);
          if (raw) foldersSet.add(raw);

          // Add intermediate ancestor directories (e.g. "Comcil 26-27/All/Sub" -> "Comcil 26-27", "Comcil 26-27/All")
          const parts = clean.split('/').filter(Boolean);
          let acc = '';
          for (let i = 0; i < parts.length - 1; i++) {
            acc = acc ? `${acc}/${parts[i]}` : parts[i];
            if (acc) foldersSet.add(acc);
          }
        }
      }
    } catch (e: any) {
      console.warn('[Staging] Failed querying DB folders:', e.message);
    }

    // 2. Scan permanent media filesystem (MEDIA_ROOT)
    if (fs.existsSync(MEDIA_ROOT)) {
      async function walkMedia(currentDir: string, relPath: string) {
        try {
          const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
              const nextRel = relPath ? `${relPath}/${entry.name}` : entry.name;
              foldersSet.add(nextRel);
              await walkMedia(path.join(currentDir, entry.name), nextRel);
            }
          }
        } catch {}
      }
      await walkMedia(MEDIA_ROOT, '');
    }

    // 3. Scan staging filesystem (STAGING_ROOT)
    if (fs.existsSync(STAGING_ROOT)) {
      async function walkStaging(currentDir: string, relPath: string) {
        try {
          const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
              const nextRel = relPath ? `${relPath}/${entry.name}` : entry.name;
              foldersSet.add(nextRel);
              await walkStaging(path.join(currentDir, entry.name), nextRel);
            }
          }
        } catch {}
      }
      await walkStaging(STAGING_ROOT, '');
    }

    const folders = Array.from(foldersSet);
    folders.sort();
    return folders;
  }

  /**
   * Creates a directory within STAGING_ROOT with recursive support.
   */
  static async createFolder(folderPath: string): Promise<string> {
    const cleanPath = sanitizeSessionId(folderPath);
    if (!cleanPath) {
      throw new Error('Invalid folder path');
    }

    const targetDir = path.join(STAGING_ROOT, cleanPath);
    const resolvedTarget = path.resolve(targetDir);
    const resolvedRoot = path.resolve(STAGING_ROOT);

    if (!resolvedTarget.startsWith(resolvedRoot)) {
      throw new Error('Access denied: folder path outside staging root');
    }

    await fs.promises.mkdir(resolvedTarget, { recursive: true });

    // Register folder in folder_settings so web gallery sees it immediately
    await query(`
      INSERT INTO folder_settings (folder_path)
      VALUES ($1)
      ON CONFLICT (folder_path) DO NOTHING
    `, [cleanPath]).catch(() => {});

    // Invalidate Redis directory caches
    await deleteKeysByPattern('folder_dirs_v2:*').catch(() => {});

    return cleanPath;
  }

  /**
   * Returns list of staging sessions, photo count, and active share URLs.
   */
  static async listSessions(): Promise<StagingSessionSummary[]> {
    const sessionMap = new Map<string, {
      sessionId: string;
      folderPath: string;
      photoCount: number;
      sizeBytes: number;
      createdAt: string;
      lastModifiedAt: string;
      shares: StagingSessionShare[];
    }>();

    // 1. Scan filesystem for session directories in STAGING_ROOT
    if (fs.existsSync(STAGING_ROOT)) {
      try {
        const folders = await this.listFolders();
        for (const rel of folders) {
          const fullDir = path.join(STAGING_ROOT, rel);
          const stat = await fs.promises.stat(fullDir);
          sessionMap.set(rel, {
            sessionId: rel,
            folderPath: `staging/${rel}`,
            photoCount: 0,
            sizeBytes: 0,
            createdAt: stat.birthtime.toISOString(),
            lastModifiedAt: stat.mtime.toISOString(),
            shares: []
          });
        }
      } catch (err: any) {
        console.error('[Staging] Failed to scan STAGING_ROOT folders:', err.message);
      }
    }

    // 2. Query media_files in DB for all staging sessions
    const dbMediaRes = await query(`
      SELECT folder_path, COUNT(*)::int as photo_count, COALESCE(SUM(size_bytes), 0)::bigint as total_bytes,
             MIN(created_at) as first_created, MAX(created_at) as last_created
      FROM media_files
      WHERE is_staged = true OR folder_path LIKE 'staging/%'
      GROUP BY folder_path
    `);

    for (const row of dbMediaRes.rows) {
      const sessionId = row.folder_path.replace(/^staging\/?/, '');
      const safeId = sanitizeSessionId(sessionId);
      const existing = sessionMap.get(safeId);
      if (existing) {
        existing.photoCount = row.photo_count;
        existing.sizeBytes = Number(row.total_bytes);
        if (row.first_created) existing.createdAt = new Date(row.first_created).toISOString();
        if (row.last_created) existing.lastModifiedAt = new Date(row.last_created).toISOString();
      } else {
        sessionMap.set(safeId, {
          sessionId: safeId,
          folderPath: safeId,
          photoCount: row.photo_count,
          sizeBytes: Number(row.total_bytes),
          createdAt: row.first_created ? new Date(row.first_created).toISOString() : new Date().toISOString(),
          lastModifiedAt: row.last_created ? new Date(row.last_created).toISOString() : new Date().toISOString(),
          shares: []
        });
      }
    }

    // 3. Query shared_folders in DB for active share tokens
    const appDomain = (process.env.APP_DOMAIN || '').replace(/\/+$/, '');
    const sharesRes = await query(`
      SELECT id, folder_path, share_token, is_active, expires_at, allow_download_images, allow_download_folder, watermark_enabled, created_at
      FROM shared_folders
      WHERE (folder_path LIKE 'staging/%' OR folder_path = ANY($1::text[])) AND is_active = true
      ORDER BY created_at DESC
    `, [Array.from(sessionMap.keys())]);

    for (const s of sharesRes.rows) {
      const sessionId = s.folder_path.replace(/^staging\/?/, '');
      const safeId = sanitizeSessionId(sessionId);
      const session = sessionMap.get(safeId);
      if (session) {
        const shareUrl = appDomain ? `${appDomain}/share/${s.share_token}` : `/share/${s.share_token}`;
        session.shares.push({
          id: s.id,
          shareToken: s.share_token,
          shareUrl,
          isActive: s.is_active,
          expiresAt: s.expires_at ? new Date(s.expires_at).toISOString() : null,
          allowDownloadImages: s.allow_download_images,
          allowDownloadFolder: s.allow_download_folder,
          watermarkEnabled: s.watermark_enabled,
          createdAt: new Date(s.created_at).toISOString()
        });
      }
    }

    return Array.from(sessionMap.values()).sort((a, b) => 
      new Date(b.lastModifiedAt).getTime() - new Date(a.lastModifiedAt).getTime()
    );
  }

  /**
   * Cleans up/deletes temporary staging images when event is complete.
   */
  static async cleanupSession(sessionId: string): Promise<{ deletedPhotosCount: number; sessionId: string }> {
    const safeSessionId = sanitizeSessionId(sessionId);
    if (!safeSessionId) {
      throw new Error('Invalid or missing sessionId');
    }

    const folderPath = safeSessionId;
    const legacyPath = `staging/${safeSessionId}`;
    const sessionDir = path.join(STAGING_ROOT, safeSessionId);

    // 1. Get all media files belonging to this session
    const filesRes = await query(
      `SELECT id, file_name FROM media_files 
       WHERE folder_path = $1 OR folder_path LIKE $2 
          OR folder_path = $3 OR folder_path LIKE $4`,
      [folderPath, `${folderPath}/%`, legacyPath, `${legacyPath}/%`]
    );

    const deletedPhotosCount = filesRes.rows.length;

    // 2. Delete cached thumbnails and previews
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

      // Delete watermarked cached previews
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
    await query(`DELETE FROM shared_folders WHERE folder_path = $1 OR folder_path LIKE $2`, [folderPath, `${folderPath}/%`]);
    await query(`DELETE FROM folder_settings WHERE folder_path = $1 OR folder_path LIKE $2`, [folderPath, `${folderPath}/%`]);
    await query(`DELETE FROM media_files WHERE folder_path = $1 OR folder_path LIKE $2`, [folderPath, `${folderPath}/%`]);

    // 4. Remove physical files and directory from STAGING_ROOT
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
      deletedPhotosCount,
      sessionId: safeSessionId
    };
  }

  private static burstClusterTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Debounced burst clustering trigger so rapid consecutive uploads are clustered together.
   */
  static scheduleBurstClustering(folderPath: string) {
    const existing = this.burstClusterTimers.get(folderPath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.burstClusterTimers.delete(folderPath);
      this.evaluateBurstsForFolder(folderPath).catch(err => {
        console.warn(`[Staging] Burst clustering error for ${folderPath}:`, err.message);
      });
    }, 1000);

    this.burstClusterTimers.set(folderPath, timer);
  }

  /**
   * Evaluate burst sequences for any folder (staging or normal gallery).
   * Groups photos within Δt ≤ 2.2s, but splits if face count changes (new people joining).
   * Calculates sharpness and face clarity scores to pick the best hero shot automatically.
   */
  static async evaluateBurstsForFolder(folderPath: string): Promise<void> {
    const cleanFolderPath = (folderPath || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!cleanFolderPath) return;

    // Fetch all photos in this folder along with visual search embeddings
    const res = await query(
      `SELECT m.id, m.file_name, m.folder_path, m.exif_json, m.created_at, m.burst_group_id, m.is_hero, m.quality_score,
              COALESCE(m.face_count, (SELECT COUNT(*)::int FROM face_embeddings WHERE media_id = m.id), 0) AS face_count,
              s.embedding::text as embedding
       FROM media_files m
       LEFT JOIN smart_search_embeddings s ON s.media_id = m.id
       WHERE m.folder_path = $1 OR m.folder_path = $2
       ORDER BY m.file_name ASC`,
      [cleanFolderPath, `staging/${cleanFolderPath}`]
    );

    const photos = res.rows;
    if (photos.length <= 1) return;

    // Helper to get epoch timestamp from photo
    const parseTime = (row: any): number => {
      const exif = row.exif_json;
      if (exif) {
        const dtStr = exif.DateTimeOriginal || exif.CreateDate || exif.ModifyDate || exif.timestamp;
        if (dtStr) {
          const parsed = Date.parse(dtStr);
          if (!isNaN(parsed)) return parsed;
        }
      }
      // Fallback: check filename for timestamp e.g. KM-20261026-152951-00031-DSC08372.jpg
      const match = row.file_name.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_](\d{2})[-_]?(\d{2})[-_]?(\d{2})/);
      if (match) {
        const [_, y, m, d, hh, mm, ss] = match;
        const parsed = Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(hh, 10), parseInt(mm, 10), parseInt(ss, 10));
        if (!isNaN(parsed)) return parsed;
      }
      return new Date(row.created_at).getTime();
    };

    // Sort photos accurately by captured time
    photos.sort((a: any, b: any) => {
      const ta = parseTime(a);
      const tb = parseTime(b);
      if (ta !== tb) return ta - tb;
      return a.file_name.localeCompare(b.file_name);
    });

    const parseVec = (str: string | null): Float32Array | null => {
      if (!str) return null;
      try {
        return new Float32Array(JSON.parse(str));
      } catch {
        return null;
      }
    };

    const cosineSim = (a: Float32Array | null, b: Float32Array | null): number => {
      if (!a || !b) return 0;
      let dot = 0;
      for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
      return dot;
    };

    photos.forEach((p: any) => {
      p.vec = parseVec(p.embedding);
    });

    // Cluster photos into bursts and similar pose sequences
    const clusters: Array<typeof photos> = [];
    let currentCluster: typeof photos = [photos[0]];

    for (let i = 1; i < photos.length; i++) {
      const prev = photos[i - 1];
      const curr = photos[i];

      const dt = Math.abs(parseTime(curr) - parseTime(prev));
      const prevFaces = Number(prev.face_count || 0);
      const currFaces = Number(curr.face_count || 0);

      // Guardrails:
      // 1. Must maintain composition (never stack if someone stepped in or out)
      const isSameComposition = prevFaces === currFaces;

      // 2. Either rapid burst (Δt ≤ 3.0s) OR photoshoot take sequence (Δt ≤ 28s with high visual similarity)
      const isFastBurst = dt <= 3000;
      const sim = cosineSim(prev.vec, curr.vec);
      const anchorSim = cosineSim(currentCluster[0].vec, curr.vec);
      const isVisualSequence = dt <= 28000 && (sim >= 0.75 || anchorSim >= 0.75);

      if (isSameComposition && (isFastBurst || isVisualSequence)) {
        currentCluster.push(curr);
      } else {
        clusters.push(currentCluster);
        currentCluster = [curr];
      }
    }
    if (currentCluster.length > 0) {
      clusters.push(currentCluster);
    }

    // Process clusters
    for (const cluster of clusters) {
      if (cluster.length === 1) {
        const single = cluster[0];
        if (single.burst_group_id !== null || single.is_hero !== true) {
          await query(
            `UPDATE media_files SET burst_group_id = NULL, is_hero = true WHERE id = $1`,
            [single.id]
          );
        }
        continue;
      }

      // Group of 2 or more: Burst detected!
      // Reuse existing burst_group_id if one of the photos already has one
      const existingGroupId = cluster.find((p: any) => p.burst_group_id)?.burst_group_id || crypto.randomUUID();

      // Check if user has already manually chosen a hero in this cluster
      const manuallyPickedHero = cluster.find((p: any) => p.is_hero === true && p.burst_group_id === existingGroupId);

      // Calculate quality scores for each photo in the cluster
      const scoredPhotos: Array<{ id: string; score: number; faceCount: number }> = [];

      for (const photo of cluster) {
        let score = 50; // base score

        // 1. Focus sharpness using Laplacian variance on preview / 480p thumbnail
        try {
          const thumb480 = path.join(CACHE_ROOT, '480p', `${photo.id}.webp`);
          const fullPath = resolveMediaFullPath(photo.folder_path || cleanFolderPath, photo.file_name);
          const targetToAnalyze = fs.existsSync(thumb480) ? thumb480 : (fs.existsSync(fullPath) ? fullPath : null);

          if (targetToAnalyze) {
            const sharpModule = await import('sharp');
            const sharp = sharpModule.default || sharpModule;
            const stats = await sharp(targetToAnalyze)
              .resize(480, 480, { fit: 'inside' })
              .greyscale()
              .convolve({
                width: 3,
                height: 3,
                kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0]
              })
              .stats();
            const sharpness = stats.channels[0]?.stdev || 0;
            score += Math.min(40, sharpness * 2);

            // 2. Face clarity & gaze/focus bonus (per-face sharpness)
            const facesRes = await query(
              `SELECT bounding_box FROM face_embeddings WHERE media_id = $1`,
              [photo.id]
            );
            if (facesRes.rows.length > 0) {
              score += 10;
              let totalFaceSharpness = 0;
              let analyzedFaces = 0;

              for (const fRow of facesRes.rows) {
                const bb = fRow.bounding_box;
                if (bb && typeof bb.x1 === 'number' && typeof bb.x2 === 'number') {
                  const left = Math.max(0, Math.floor(bb.x1));
                  const top = Math.max(0, Math.floor(bb.y1));
                  const width = Math.max(1, Math.floor(bb.x2 - bb.x1));
                  const height = Math.max(1, Math.floor(bb.y2 - bb.y1));

                  try {
                    const faceStats = await sharp(targetToAnalyze)
                      .extract({ left, top, width, height })
                      .greyscale()
                      .convolve({
                        width: 3,
                        height: 3,
                        kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0]
                      })
                      .stats();
                    totalFaceSharpness += faceStats.channels[0]?.stdev || 0;
                    analyzedFaces++;
                  } catch {}
                }
              }

              if (analyzedFaces > 0) {
                const avgFaceSharpness = totalFaceSharpness / analyzedFaces;
                score += Math.min(25, avgFaceSharpness * 1.5);
              }
            }
          }
        } catch {}

        const faces = Number(photo.face_count || 0);
        scoredPhotos.push({ id: photo.id, score, faceCount: faces });
      }

      // Determine hero
      let heroId: string;
      if (manuallyPickedHero) {
        heroId = manuallyPickedHero.id;
      } else {
        scoredPhotos.sort((a, b) => b.score - a.score);
        heroId = scoredPhotos[0].id;
      }

      // Update media records
      for (const item of scoredPhotos) {
        const isHero = item.id === heroId;
        await query(
          `UPDATE media_files 
           SET burst_group_id = $1, is_hero = $2, quality_score = $3, face_count = $4 
           WHERE id = $5`,
          [existingGroupId, isHero, item.score, item.faceCount, item.id]
        );
      }
    }
  }

  /**
   * Evaluate burst sequences for all subfolders under a root folder recursively.
   */
  static async evaluateBurstsRecursively(folderPath: string): Promise<void> {
    const cleanFolder = (folderPath || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const folderRes = await query(
      `SELECT DISTINCT folder_path FROM media_files WHERE folder_path = $1 OR folder_path LIKE $2`,
      [cleanFolder, `${cleanFolder}/%`]
    );
    for (const row of folderRes.rows) {
      await StagingService.evaluateBurstsForFolder(row.folder_path);
    }
  }

  /**
   * Fetch all peer photos in a burst group.
   */
  static async getAlternates(mediaId: string): Promise<any[]> {
    const mediaRes = await query(`SELECT id, burst_group_id, folder_path FROM media_files WHERE id = $1`, [mediaId]);
    if (mediaRes.rows.length === 0) return [];
    const current = mediaRes.rows[0];

    if (!current.burst_group_id) {
      const single = await query(
        `SELECT id, folder_path, file_name, mime_type, size_bytes, blurhash, exif_json, 
                has_1080p, has_480p, created_at, updated_at, img_width, img_height, is_staged,
                burst_group_id, is_hero, quality_score, face_count, 1 as burst_count
         FROM media_files WHERE id = $1`,
        [mediaId]
      );
      return single.rows;
    }

    const peers = await query(
      `SELECT id, folder_path, file_name, mime_type, size_bytes, blurhash, exif_json, 
              has_1080p, has_480p, created_at, updated_at, img_width, img_height, is_staged,
              burst_group_id, is_hero, quality_score, face_count,
              (SELECT COUNT(*)::int FROM media_files b WHERE b.burst_group_id = media_files.burst_group_id) as burst_count
       FROM media_files 
       WHERE burst_group_id = $1 
       ORDER BY is_hero DESC, COALESCE((exif_json->>'DateTimeOriginal')::timestamp, created_at) ASC, file_name ASC`,
      [current.burst_group_id]
    );
    return peers.rows;
  }

  /**
   * Promote a specific photo to become the primary Hero of its burst group.
   */
  static async setHero(mediaId: string): Promise<{ success: boolean; heroId: string; burstGroupId: string | null }> {
    const mediaRes = await query(`SELECT id, burst_group_id, folder_path FROM media_files WHERE id = $1`, [mediaId]);
    if (mediaRes.rows.length === 0) {
      throw new Error('Media not found');
    }
    const current = mediaRes.rows[0];
    if (!current.burst_group_id) {
      await query(`UPDATE media_files SET is_hero = true WHERE id = $1`, [mediaId]);
      return { success: true, heroId: mediaId, burstGroupId: null };
    }

    await query(`UPDATE media_files SET is_hero = false WHERE burst_group_id = $1`, [current.burst_group_id]);
    await query(`UPDATE media_files SET is_hero = true WHERE id = $1`, [mediaId]);

    return { success: true, heroId: mediaId, burstGroupId: current.burst_group_id };
  }

  /**
   * Toggle visibility (is_hero) of an alternate photo in a burst group.
   */
  static async toggleVisibility(mediaId: string, show?: boolean): Promise<{ success: boolean; mediaId: string; is_hero: boolean; burstGroupId: string | null }> {
    const mediaRes = await query(`SELECT id, burst_group_id, folder_path, is_hero FROM media_files WHERE id = $1`, [mediaId]);
    if (mediaRes.rows.length === 0) {
      throw new Error('Media not found');
    }
    const current = mediaRes.rows[0];
    const newIsHero = typeof show === 'boolean' ? show : !current.is_hero;

    await query(`UPDATE media_files SET is_hero = $1 WHERE id = $2`, [newIsHero, mediaId]);

    return {
      success: true,
      mediaId,
      is_hero: newIsHero,
      burstGroupId: current.burst_group_id || null
    };
  }
}
