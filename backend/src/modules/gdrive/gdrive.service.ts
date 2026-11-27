import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { query } from '../../config/db';
import { logger } from '../../utils/logger';
import { CaesiumService, CaesiumConfig } from './caesium.service';

export interface GoogleAccountRecord {
  id: string;
  email: string;
  label: string | null;
  access_token: string;
  refresh_token: string;
  token_expiry: string | null;
  created_at: string;
}

export interface FolderGDriveSyncRecord {
  id: string;
  account_id: string;
  source_type: 'MEDIA' | 'FASTUP';
  folder_path: string;
  gdrive_folder_id: string;
  gdrive_folder_name: string;
  gdrive_link: string;
  is_active: boolean;
  auto_sync: boolean;
  sync_status: 'IDLE' | 'SYNCING' | 'ERROR';
  last_synced_at: string | null;
  error_message: string | null;
  created_at: string;
  caesium_enabled?: boolean;
  caesium_config?: CaesiumConfig | null;
  watermark_enabled?: boolean;
  watermark_template_id?: string | null;
  watermark_template_name?: string | null;
}

export class GDriveService {
  private static getRedirectUri(): string {
    const appDomain = (process.env.PUBLIC_APP_DOMAIN || process.env.APP_DOMAIN || 'http://localhost:8000').replace(/\/+$/, '');
    return `${appDomain}/api/admin/gdrive/callback`;
  }

  static getOAuth2Client(tokens?: { access_token?: string; refresh_token?: string }) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = this.getRedirectUri();

    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    if (tokens) {
      oauth2Client.setCredentials({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token
      });
    }

    return oauth2Client;
  }

  static generateAuthUrl(state?: string): string {
    const oauth2Client = this.getOAuth2Client();
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
      ],
      state: state || 'admin'
    });
  }

  static async handleOAuthCallback(code: string): Promise<GoogleAccountRecord> {
    const oauth2Client = this.getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    if (!tokens.refresh_token) {
      // In case Google did not supply refresh token because consent wasn't prompted
      logger.warn('[GDrive] No refresh token returned from Google callback');
    }

    // Get user info
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;
    const name = userInfo.data.name || email || 'Google Drive Account';

    if (!email) {
      throw new Error('Failed to retrieve email address from Google Account');
    }

    const expiryDate = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

    // Check if account already exists
    const existing = await query('SELECT id, refresh_token FROM google_accounts WHERE email = $1', [email]);
    let accountId: string;

    const refreshTokenToSave = tokens.refresh_token || (existing.rows[0]?.refresh_token ?? '');

    if (existing.rows.length > 0) {
      accountId = existing.rows[0].id;
      await query(
        `UPDATE google_accounts 
         SET access_token = $1, 
             refresh_token = COALESCE(NULLIF($2, ''), refresh_token), 
             token_expiry = $3, 
             label = $4,
             updated_at = NOW() 
         WHERE id = $5`,
        [tokens.access_token || '', refreshTokenToSave, expiryDate, name, accountId]
      );
    } else {
      const ins = await query(
        `INSERT INTO google_accounts (email, label, access_token, refresh_token, token_expiry)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [email, name, tokens.access_token || '', refreshTokenToSave, expiryDate]
      );
      accountId = ins.rows[0].id;
    }

    const res = await query('SELECT * FROM google_accounts WHERE id = $1', [accountId]);
    return res.rows[0];
  }

  static async getAuthenticatedClient(accountId: string) {
    const res = await query('SELECT * FROM google_accounts WHERE id = $1', [accountId]);
    if (res.rows.length === 0) {
      throw new Error(`Google Account not found for id: ${accountId}`);
    }
    const acc: GoogleAccountRecord = res.rows[0];
    const oauth2Client = this.getOAuth2Client({
      access_token: acc.access_token,
      refresh_token: acc.refresh_token
    });

    // Listen to token refresh events to save fresh tokens
    oauth2Client.on('tokens', async (newTokens) => {
      try {
        const expiry = newTokens.expiry_date ? new Date(newTokens.expiry_date) : null;
        await query(
          `UPDATE google_accounts 
           SET access_token = $1, 
               refresh_token = COALESCE($2, refresh_token), 
               token_expiry = COALESCE($3, token_expiry),
               updated_at = NOW()
           WHERE id = $4`,
          [newTokens.access_token, newTokens.refresh_token || null, expiry, accountId]
        );
      } catch (err: any) {
        logger.error(`[GDrive] Failed to update refreshed tokens for account ${accountId}:`, err);
      }
    });

    return { client: oauth2Client, account: acc };
  }

  static async listAccounts(): Promise<GoogleAccountRecord[]> {
    const res = await query('SELECT id, email, label, token_expiry, created_at FROM google_accounts ORDER BY created_at DESC');
    return res.rows;
  }

  static async deleteAccount(accountId: string): Promise<boolean> {
    const res = await query('DELETE FROM google_accounts WHERE id = $1', [accountId]);
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * List folders in Google Drive for directory selection.
   * Supports parentId filter (defaults to root if not provided).
   */
  static async listDriveFolders(accountId: string, parentId?: string): Promise<Array<{ id: string; name: string; webViewLink?: string }>> {
    const { client } = await this.getAuthenticatedClient(accountId);
    const drive = google.drive({ version: 'v3', auth: client });

    let queryStr = `mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    if (parentId && parentId !== 'root') {
      queryStr += ` and '${parentId}' in parents`;
    } else if (parentId === 'root') {
      queryStr += ` and 'root' in parents`;
    }

    const res = await drive.files.list({
      q: queryStr,
      fields: 'files(id, name, webViewLink, parents)',
      orderBy: 'name',
      pageSize: 100
    });

    return (res.data.files || []).map(f => ({
      id: f.id!,
      name: f.name!,
      webViewLink: f.webViewLink || undefined
    }));
  }

  /**
   * Creates a Google Drive folder and sets public "anyone with link" reader permissions.
   */
  static async createShareableFolder(params: {
    accountId: string;
    folderName: string;
    parentFolderId?: string;
  }): Promise<{ folderId: string; webViewLink: string }> {
    const { client } = await this.getAuthenticatedClient(params.accountId);
    const drive = google.drive({ version: 'v3', auth: client });

    const parentId = params.parentFolderId || process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
    const parents = parentId ? [parentId] : undefined;

    // 1. Create Folder
    const folderRes = await drive.files.create({
      requestBody: {
        name: params.folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents
      },
      fields: 'id, name, webViewLink'
    });

    const folderId = folderRes.data.id;
    if (!folderId) {
      throw new Error('Failed to create folder on Google Drive');
    }

    // 2. Grant public read permission (anyone with link)
    try {
      await drive.permissions.create({
        fileId: folderId,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        }
      });
    } catch (permErr: any) {
      logger.warn(`[GDrive] Warning setting public permission on folder ${folderId}:`, permErr.message);
    }

    // 3. Fetch webViewLink
    const getRes = await drive.files.get({
      fileId: folderId,
      fields: 'id, webViewLink'
    });

    const webViewLink = getRes.data.webViewLink || `https://drive.google.com/drive/folders/${folderId}`;

    return {
      folderId,
      webViewLink
    };
  }

  /**
   * Uploads a local JPEG image to the designated Google Drive folder.
   */
  static async uploadJPEG(params: {
    accountId: string;
    gdriveFolderId: string;
    localFilePath: string;
    fileName: string;
  }): Promise<{ fileId: string }> {
    const { client } = await this.getAuthenticatedClient(params.accountId);
    const drive = google.drive({ version: 'v3', auth: client });

    if (!fs.existsSync(params.localFilePath)) {
      throw new Error(`File does not exist: ${params.localFilePath}`);
    }

    const stat = fs.statSync(params.localFilePath);

    // Check if file already exists in this folder to avoid duplicates
    const searchRes = await drive.files.list({
      q: `'${params.gdriveFolderId}' in parents and name = '${params.fileName.replace(/'/g, "\\'")}' and trashed = false`,
      fields: 'files(id, name, size)'
    });

    if (searchRes.data.files && searchRes.data.files.length > 0) {
      const existing = searchRes.data.files[0];
      return { fileId: existing.id! };
    }

    const fileStream = fs.createReadStream(params.localFilePath);

    const ext = path.extname(params.fileName).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff'
    };
    const mimeType = mimeMap[ext] || 'image/jpeg';

    const uploadRes = await drive.files.create({
      requestBody: {
        name: params.fileName,
        parents: [params.gdriveFolderId]
      },
      media: {
        mimeType,
        body: fileStream
      },
      fields: 'id, name, size'
    });

    const fileId = uploadRes.data.id;
    if (!fileId) {
      throw new Error(`Failed to upload file ${params.fileName} to Google Drive`);
    }

    return { fileId };
  }

  /**
   * Deletes a file from Google Drive.
   */
  static async deleteGDriveFile(accountId: string, gdriveFileId: string): Promise<boolean> {
    try {
      const { client } = await this.getAuthenticatedClient(accountId);
      const drive = google.drive({ version: 'v3', auth: client });
      await drive.files.delete({ fileId: gdriveFileId });
      return true;
    } catch (err: any) {
      if (err?.code === 404) return true;
      logger.error(`[GDrive] Failed to delete file ${gdriveFileId}:`, err.message);
      return false;
    }
  }

  /**
   * Get sync configuration for a specific folder path and source type.
   */
  static async getSyncConfig(folderPath: string, sourceType: 'MEDIA' | 'FASTUP'): Promise<FolderGDriveSyncRecord | null> {
    const res = await query(
      `SELECT s.*, wt.name as watermark_template_name 
       FROM folder_gdrive_syncs s
       LEFT JOIN watermark_templates wt ON wt.id = s.watermark_template_id
       WHERE s.folder_path = $1 AND s.source_type = $2`,
      [folderPath, sourceType]
    );
    return res.rows[0] || null;
  }

  /**
   * Create or update sync configuration.
   * If existingFolderId is supplied, adopts that folder on Drive and sets it to public reader.
   */
  static async setSyncConfig(params: {
    accountId: string;
    sourceType: 'MEDIA' | 'FASTUP';
    folderPath: string;
    folderName?: string;
    existingFolderId?: string;
    caesiumEnabled?: boolean;
    caesiumConfig?: CaesiumConfig;
    saveAsDefault?: boolean;
    watermarkEnabled?: boolean;
    watermarkTemplateId?: string | null;
  }): Promise<FolderGDriveSyncRecord> {
    const existing = await this.getSyncConfig(params.folderPath, params.sourceType);

    const caesiumEnabled = params.caesiumEnabled !== undefined 
      ? Boolean(params.caesiumEnabled) 
      : (existing?.caesium_enabled ?? false);
    const caesiumConfig = params.caesiumConfig || existing?.caesium_config || {};

    const watermarkEnabled = params.watermarkEnabled !== undefined 
      ? Boolean(params.watermarkEnabled) 
      : (params.watermarkTemplateId ? true : (existing?.watermark_enabled ?? false));
    const watermarkTemplateId = params.watermarkTemplateId !== undefined
      ? params.watermarkTemplateId
      : (existing?.watermark_template_id ?? null);

    if (params.saveAsDefault && params.caesiumConfig) {
      await CaesiumService.saveDefaultConfig({
        ...params.caesiumConfig,
        enabled: caesiumEnabled
      }).catch(err => logger.warn(`[GDrive] Failed to save default Caesium config: ${err.message}`));
    }

    if (existing && !params.existingFolderId) {
      // If already configured and account matches, update params and return
      if (existing.account_id === params.accountId && existing.gdrive_folder_id) {
        const upd = await query(
          `UPDATE folder_gdrive_syncs 
           SET caesium_enabled = $1, caesium_config = $2, watermark_enabled = $3, watermark_template_id = $4 
           WHERE id = $5 
           RETURNING *`,
          [caesiumEnabled, JSON.stringify(caesiumConfig), watermarkEnabled, watermarkTemplateId, existing.id]
        );
        return upd.rows[0];
      }
    }

    let targetFolderId: string;
    let targetFolderName: string;
    let targetWebViewLink: string;

    if (params.existingFolderId) {
      // Adopt existing folder on Google Drive
      targetFolderId = params.existingFolderId;
      const { client } = await this.getAuthenticatedClient(params.accountId);
      const drive = google.drive({ version: 'v3', auth: client });

      // Ensure public read permissions
      try {
        await drive.permissions.create({
          fileId: targetFolderId,
          requestBody: { role: 'reader', type: 'anyone' }
        });
      } catch (e: any) {
        logger.warn(`[GDrive] Warning ensuring public perm for folder ${targetFolderId}:`, e.message);
      }

      const getRes = await drive.files.get({
        fileId: targetFolderId,
        fields: 'id, name, webViewLink'
      });
      targetFolderName = getRes.data.name || params.folderName || 'Drive Folder';
      targetWebViewLink = getRes.data.webViewLink || `https://drive.google.com/drive/folders/${targetFolderId}`;
    } else {
      const folderName = params.folderName || path.basename(params.folderPath) || 'Photos';
      const driveFolder = await this.createShareableFolder({
        accountId: params.accountId,
        folderName,
      });
      targetFolderId = driveFolder.folderId;
      targetFolderName = folderName;
      targetWebViewLink = driveFolder.webViewLink;
    }

    const res = await query(
      `INSERT INTO folder_gdrive_syncs 
         (account_id, source_type, folder_path, gdrive_folder_id, gdrive_folder_name, gdrive_link, is_active, auto_sync, sync_status, caesium_enabled, caesium_config, watermark_enabled, watermark_template_id)
       VALUES ($1, $2, $3, $4, $5, $6, true, true, 'IDLE', $7, $8, $9, $10)
       ON CONFLICT (folder_path, source_type) DO UPDATE SET
         account_id = EXCLUDED.account_id,
         gdrive_folder_id = EXCLUDED.gdrive_folder_id,
         gdrive_folder_name = EXCLUDED.gdrive_folder_name,
         gdrive_link = EXCLUDED.gdrive_link,
         is_active = true,
         sync_status = 'IDLE',
         error_message = NULL,
         caesium_enabled = EXCLUDED.caesium_enabled,
         caesium_config = EXCLUDED.caesium_config,
         watermark_enabled = EXCLUDED.watermark_enabled,
         watermark_template_id = EXCLUDED.watermark_template_id
       RETURNING *`,
      [params.accountId, params.sourceType, params.folderPath, targetFolderId, targetFolderName, targetWebViewLink, caesiumEnabled, JSON.stringify(caesiumConfig), watermarkEnabled, watermarkTemplateId]
    );

    return res.rows[0];
  }

  /**
   * Update Caesium image compressor settings for a folder sync.
   */
  static async updateCaesiumSyncConfig(params: {
    folderPath: string;
    sourceType: 'MEDIA' | 'FASTUP';
    caesiumEnabled: boolean;
    caesiumConfig: CaesiumConfig;
    saveAsDefault?: boolean;
  }): Promise<FolderGDriveSyncRecord> {
    const existing = await this.getSyncConfig(params.folderPath, params.sourceType);
    if (!existing) {
      throw new Error('Google Drive sync is not configured for this folder');
    }

    if (params.saveAsDefault) {
      await CaesiumService.saveDefaultConfig({
        ...params.caesiumConfig,
        enabled: params.caesiumEnabled
      }).catch(err => logger.warn(`[GDrive] Failed to save default Caesium config: ${err.message}`));
    }

    const res = await query(
      `UPDATE folder_gdrive_syncs 
       SET caesium_enabled = $1, caesium_config = $2 
       WHERE id = $3 
       RETURNING *`,
      [Boolean(params.caesiumEnabled), JSON.stringify(params.caesiumConfig), existing.id]
    );

    return res.rows[0];
  }

  /**
   * Update Watermark settings for an active folder sync.
   */
  static async updateWatermarkSyncConfig(params: {
    folderPath: string;
    sourceType: 'MEDIA' | 'FASTUP';
    watermarkEnabled: boolean;
    watermarkTemplateId?: string | null;
  }): Promise<FolderGDriveSyncRecord> {
    const existing = await this.getSyncConfig(params.folderPath, params.sourceType);
    if (!existing) {
      throw new Error('Google Drive sync is not configured for this folder');
    }

    const watermarkEnabled = Boolean(params.watermarkEnabled || params.watermarkTemplateId);
    const watermarkTemplateId = params.watermarkTemplateId || null;

    const res = await query(
      `UPDATE folder_gdrive_syncs 
       SET watermark_enabled = $1, watermark_template_id = $2 
       WHERE id = $3 
       RETURNING *`,
      [watermarkEnabled, watermarkTemplateId, existing.id]
    );

    return res.rows[0];
  }

  /**
   * Remove/unlink sync configuration.
   * If deleteRemoteFolder is true, also permanently deletes the folder and all contents on Google Drive.
   */
  static async removeSyncConfig(folderPath: string, sourceType: 'MEDIA' | 'FASTUP', deleteRemoteFolder = false): Promise<boolean> {
    const existing = await this.getSyncConfig(folderPath, sourceType);
    if (!existing) return false;

    if (deleteRemoteFolder && existing.gdrive_folder_id) {
      try {
        await this.deleteGDriveFile(existing.account_id, existing.gdrive_folder_id);
        logger.info(`[GDrive] Deleted remote folder ${existing.gdrive_folder_id} from Google Drive`);
      } catch (err: any) {
        logger.warn(`[GDrive] Could not delete remote folder:`, err.message);
      }
    }

    const res = await query(
      `DELETE FROM folder_gdrive_syncs WHERE id = $1`,
      [existing.id]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Helper to check if a filename is a JPEG.
   */
  static isJPEG(fileName: string): boolean {
    const ext = path.extname(fileName).toLowerCase();
    return ext === '.jpg' || ext === '.jpeg';
  }

  /**
   * Get Google Drive link for a specific media file if it has been synced.
   */
  static async getMediaDriveLink(mediaId: string): Promise<{ synced: boolean; link?: string; gdriveFileId?: string }> {
    const mediaRes = await query(
      `SELECT id, folder_path, file_name, is_staged FROM media_files WHERE id = $1`,
      [mediaId]
    );
    if (mediaRes.rows.length === 0) {
      return { synced: false };
    }
    const media = mediaRes.rows[0];
    const sourceType = media.is_staged ? 'FASTUP' : 'MEDIA';

    // 1. Check direct match for folder_path
    let syncRes = await query(
      `SELECT s.id, s.account_id, sf.gdrive_file_id
       FROM folder_gdrive_syncs s
       JOIN gdrive_synced_files sf ON sf.sync_id = s.id
       WHERE s.folder_path = $1 AND s.source_type = $2 AND sf.file_name = $3`,
      [media.folder_path, sourceType, media.file_name]
    );

    // 2. If not found and not staged, try parent folder sync if folder_path is nested
    if (syncRes.rows.length === 0 && !media.is_staged) {
      syncRes = await query(
        `SELECT s.id, s.account_id, sf.gdrive_file_id
         FROM folder_gdrive_syncs s
         JOIN gdrive_synced_files sf ON sf.sync_id = s.id
         WHERE sf.file_name = $1 AND s.source_type = 'MEDIA'
           AND ($2 = s.folder_path OR $2 LIKE s.folder_path || '/%')
         ORDER BY LENGTH(s.folder_path) DESC LIMIT 1`,
        [media.file_name, media.folder_path]
      );
    }

    if (syncRes.rows.length === 0) {
      return { synced: false };
    }

    const { gdrive_file_id } = syncRes.rows[0];
    const link = `https://drive.google.com/file/d/${gdrive_file_id}/view`;
    return {
      synced: true,
      link,
      gdriveFileId: gdrive_file_id
    };
  }
}
