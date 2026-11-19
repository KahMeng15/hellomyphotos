import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import pkg from '@resvg/resvg-js';
const { Resvg } = pkg;

import { query } from '../../config/db';
import { CacheTrackerService } from './cacheTracker.service';

export interface WatermarkTemplate {
  id: string;
  name: string;
  description?: string;
  is_default: boolean;
  type: 'text' | 'image';
  text_content: string;
  font_family: string;
  font_weight: string;
  font_style: string;
  font_color: string;
  text_align: 'left' | 'center' | 'right';
  letter_spacing: number;
  line_spacing: number;
  image_path?: string | null;
  shadow_enabled: boolean;
  shadow_color: string;
  shadow_opacity: number;
  shadow_radius: number;
  shadow_offset_x: number;
  shadow_offset_y: number;
  bg_box_enabled: boolean;
  bg_box_color: string;
  bg_box_opacity: number;
  bg_box_padding_x: number;
  bg_box_padding_y: number;
  bg_box_border_radius: number;
  anchor: 'top-left' | 'top-center' | 'top-right' | 'middle-left' | 'center' | 'middle-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  inset_x: number;
  inset_y: number;
  scale_mode: 'proportional_long_edge' | 'proportional_short_edge' | 'fit' | 'fill' | 'exact_px';
  scale_value: number;
  rotation: number;
  opacity: number;
  is_tiled: boolean;
  allow_hd_download: boolean;
  restricted_tier: '1080p' | '500px';
  apply_to_previews: boolean;
  apply_to_downloads: boolean;
  created_at?: string;
  updated_at?: string;
}

const defaultCacheDir = fs.existsSync('/app/cache') ? '/app/cache' : path.resolve(process.cwd(), '../volumes/cache_rw');
const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || defaultCacheDir);
const defaultMediaDir = fs.existsSync('/app/media') ? '/app/media' : path.resolve(process.cwd(), '../volumes/media_ro');
const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || defaultMediaDir);

const FONTS_DIR = path.resolve(import.meta.dirname, '../../assets/fonts');

export class WatermarkService {
  /**
   * Legacy method for backward compatibility
   */
  static async getSettings() {
    let text = 'hellomyphotos';
    let opacity = 0.5;
    let position = 'center';
    let enforceGlobal = false;
    let globalTemplateId: string | null = null;

    try {
      const { rows } = await query(
        `SELECT key, value FROM admin_settings WHERE key IN ('watermark_text', 'watermark_opacity', 'watermark_position', 'watermark_enforce_global', 'watermark_global_template_id')`
      );
      
      for (const r of rows) {
        if (r.key === 'watermark_text') text = typeof r.value === 'string' ? r.value : r.value;
        if (r.key === 'watermark_opacity') opacity = Number(r.value) || 0.5;
        if (r.key === 'watermark_position') position = typeof r.value === 'string' ? r.value : r.value;
        if (r.key === 'watermark_enforce_global') enforceGlobal = r.value === true || r.value === 'true';
        if (r.key === 'watermark_global_template_id') globalTemplateId = typeof r.value === 'string' ? r.value : null;
      }
    } catch {}
    
    return { text, opacity, position, enforceGlobal, globalTemplateId };
  }

  static async getGlobalEnforcement(): Promise<{ enforceGlobal: boolean; globalTemplateId: string | null }> {
    try {
      const s = await this.getSettings();
      return { enforceGlobal: s.enforceGlobal, globalTemplateId: s.globalTemplateId };
    } catch {
      return { enforceGlobal: false, globalTemplateId: null };
    }
  }

  static async getAllTemplates(): Promise<WatermarkTemplate[]> {
    const { rows } = await query(
      `SELECT * FROM watermark_templates ORDER BY is_default DESC, created_at ASC`
    );
    return rows.map(this.mapRowToTemplate);
  }

  static async getTemplate(id: string): Promise<WatermarkTemplate | null> {
    const { rows } = await query(
      `SELECT * FROM watermark_templates WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) return null;
    return this.mapRowToTemplate(rows[0]);
  }

  static async getDefaultTemplate(): Promise<WatermarkTemplate> {
    try {
      const { rows } = await query(
        `SELECT * FROM watermark_templates WHERE is_default = true LIMIT 1`
      );
      if (rows.length > 0) return this.mapRowToTemplate(rows[0]);

      const fallbackRows = await query(
        `SELECT * FROM watermark_templates ORDER BY created_at ASC LIMIT 1`
      );
      if (fallbackRows.rows.length > 0) return this.mapRowToTemplate(fallbackRows.rows[0]);
    } catch {}

    // Return a built-in default template
    return {
      id: 'default',
      name: 'Default Copyright',
      is_default: true,
      type: 'text',
      text_content: '© {year} {copyright}',
      font_family: 'Instrument Sans',
      font_weight: 'bold',
      font_style: 'normal',
      font_color: '#ffffff',
      text_align: 'center',
      letter_spacing: 0,
      line_spacing: 1.2,
      shadow_enabled: true,
      shadow_color: '#000000',
      shadow_opacity: 0.75,
      shadow_radius: 4,
      shadow_offset_x: 2,
      shadow_offset_y: 2,
      bg_box_enabled: false,
      bg_box_color: '#000000',
      bg_box_opacity: 0.5,
      bg_box_padding_x: 12,
      bg_box_padding_y: 8,
      bg_box_border_radius: 6,
      anchor: 'bottom-right',
      inset_x: 3,
      inset_y: 3,
      scale_mode: 'proportional_long_edge',
      scale_value: 15,
      rotation: 0,
      opacity: 0.85,
      is_tiled: false,
      allow_hd_download: false,
      restricted_tier: '1080p',
      apply_to_previews: true,
      apply_to_downloads: true
    };
  }

  static async createTemplate(data: Partial<WatermarkTemplate>): Promise<WatermarkTemplate> {
    if (data.is_default) {
      await query(`UPDATE watermark_templates SET is_default = false`);
    }

    const { rows } = await query(
      `INSERT INTO watermark_templates (
        name, description, is_default, type, text_content, font_family, font_weight, font_style,
        font_color, text_align, letter_spacing, line_spacing, image_path, shadow_enabled,
        shadow_color, shadow_opacity, shadow_radius, shadow_offset_x, shadow_offset_y,
        bg_box_enabled, bg_box_color, bg_box_opacity, bg_box_padding_x, bg_box_padding_y,
        bg_box_border_radius, anchor, inset_x, inset_y, scale_mode, scale_value,
        rotation, opacity, is_tiled, allow_hd_download, restricted_tier, apply_to_previews, apply_to_downloads
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37
      ) RETURNING *`,
      [
        data.name || 'Untitled Watermark',
        data.description || '',
        data.is_default ?? false,
        data.type || 'text',
        data.text_content ?? '© {year} {copyright}',
        data.font_family || 'Instrument Sans',
        data.font_weight || 'bold',
        data.font_style || 'normal',
        data.font_color || '#ffffff',
        data.text_align || 'center',
        data.letter_spacing ?? 0,
        data.line_spacing ?? 1.2,
        data.image_path || null,
        data.shadow_enabled ?? true,
        data.shadow_color || '#000000',
        data.shadow_opacity ?? 0.75,
        data.shadow_radius ?? 4,
        data.shadow_offset_x ?? 2,
        data.shadow_offset_y ?? 2,
        data.bg_box_enabled ?? false,
        data.bg_box_color || '#000000',
        data.bg_box_opacity ?? 0.5,
        data.bg_box_padding_x ?? 12,
        data.bg_box_padding_y ?? 8,
        data.bg_box_border_radius ?? 6,
        data.anchor || 'bottom-right',
        data.inset_x ?? 3,
        data.inset_y ?? 3,
        data.scale_mode || 'proportional_long_edge',
        data.scale_value ?? 15,
        data.rotation ?? 0,
        data.opacity ?? 0.85,
        data.is_tiled ?? false,
        data.allow_hd_download ?? false,
        data.restricted_tier || '1080p',
        data.apply_to_previews ?? true,
        data.apply_to_downloads ?? true
      ]
    );
    return this.mapRowToTemplate(rows[0]);
  }

  static async updateTemplate(id: string, data: Partial<WatermarkTemplate>): Promise<WatermarkTemplate> {
    if (data.is_default) {
      await query(`UPDATE watermark_templates SET is_default = false WHERE id != $1`, [id]);
    }

    const current = await this.getTemplate(id);
    if (!current) throw new Error('Watermark template not found');

    const merged = { ...current, ...data, updated_at: new Date().toISOString() };

    const { rows } = await query(
      `UPDATE watermark_templates SET
        name = $1, description = $2, is_default = $3, type = $4, text_content = $5,
        font_family = $6, font_weight = $7, font_style = $8, font_color = $9, text_align = $10,
        letter_spacing = $11, line_spacing = $12, image_path = $13, shadow_enabled = $14,
        shadow_color = $15, shadow_opacity = $16, shadow_radius = $17, shadow_offset_x = $18, shadow_offset_y = $19,
        bg_box_enabled = $20, bg_box_color = $21, bg_box_opacity = $22, bg_box_padding_x = $23, bg_box_padding_y = $24,
        bg_box_border_radius = $25, anchor = $26, inset_x = $27, inset_y = $28, scale_mode = $29, scale_value = $30,
        rotation = $31, opacity = $32, is_tiled = $33, allow_hd_download = $34, restricted_tier = $35,
        apply_to_previews = $36, apply_to_downloads = $37, updated_at = NOW()
      WHERE id = $38 RETURNING *`,
      [
        merged.name, merged.description, merged.is_default, merged.type, merged.text_content,
        merged.font_family, merged.font_weight, merged.font_style, merged.font_color, merged.text_align,
        merged.letter_spacing, merged.line_spacing, merged.image_path, merged.shadow_enabled,
        merged.shadow_color, merged.shadow_opacity, merged.shadow_radius, merged.shadow_offset_x, merged.shadow_offset_y,
        merged.bg_box_enabled, merged.bg_box_color, merged.bg_box_opacity, merged.bg_box_padding_x, merged.bg_box_padding_y,
        merged.bg_box_border_radius, merged.anchor, merged.inset_x, merged.inset_y, merged.scale_mode, merged.scale_value,
        merged.rotation, merged.opacity, merged.is_tiled, merged.allow_hd_download, merged.restricted_tier,
        merged.apply_to_previews, merged.apply_to_downloads, id
      ]
    );

    const updated = this.mapRowToTemplate(rows[0]);

    // Automatically purge old cache and regenerate watermarked photos in the background
    this.regenerateTemplatePreviews(id).catch((err) => {
      console.error('[WatermarkRegen] Background regeneration failed:', err);
    });

    return updated;
  }

  /**
   * Purge old cached preview files and regenerate watermarked photos for all active shares using this template
   */
  static async regenerateTemplatePreviews(templateId: string): Promise<{ success: boolean; purged: number; regenerated: number }> {
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const wmCacheDir = path.resolve(CACHE_ROOT, 'watermark_previews');
    if (!fs.existsSync(wmCacheDir)) {
      fs.mkdirSync(wmCacheDir, { recursive: true });
    }

    // 1. Purge all existing cache files for this template
    let purgedCount = 0;
    try {
      const files = await fs.promises.readdir(wmCacheDir);
      for (const file of files) {
        if (file.includes(`_${templateId}_`)) {
          await CacheTrackerService.unlinkFile(path.join(wmCacheDir, file)).catch(() => {});
          purgedCount++;
        }
      }
    } catch (err) {
      console.error('[WatermarkRegen] Error purging old cache:', err);
    }

    // 2. Find all active shares that use this template
    const globalSettings = await this.getGlobalEnforcement();
    const isGlobal = globalSettings.enforceGlobal && globalSettings.globalTemplateId === templateId;

    let sharesQuery: string;
    let sharesParams: any[];

    if (template.is_default || isGlobal) {
      sharesQuery = `
        SELECT folder_path, media_id, share_token
        FROM shared_folders
        WHERE is_active = true
          AND (watermark_enabled = true OR $1 = true)
          AND (watermark_template_id = $2 OR watermark_template_id IS NULL)
      `;
      sharesParams = [isGlobal, templateId];
    } else {
      sharesQuery = `
        SELECT folder_path, media_id, share_token
        FROM shared_folders
        WHERE is_active = true
          AND watermark_enabled = true
          AND watermark_template_id = $1
      `;
      sharesParams = [templateId];
    }

    const sharesRes = await query(sharesQuery, sharesParams);
    if (sharesRes.rows.length === 0) {
      console.log(`[WatermarkRegen] No active watermarked shares found for template "${template.name}" (${templateId}). Purged ${purgedCount} files.`);
      return { success: true, purged: purgedCount, regenerated: 0 };
    }

    // 3. Collect unique media files across all affected shares
    const mediaMap = new Map<string, any>();

    for (const share of sharesRes.rows) {
      if (share.media_id) {
        const singleRes = await query(
          `SELECT id, folder_path, file_name, mime_type, created_at,
                  exif_json->>'DateTimeOriginal' as captured_at,
                  exif_json->>'Make' as camera_make,
                  exif_json->>'Model' as camera_model,
                  exif_json->>'LensModel' as lens_model,
                  exif_json->>'ISO' as iso,
                  exif_json->>'ExposureTime' as shutter_speed,
                  exif_json->>'FNumber' as f_number,
                  exif_json->>'Copyright' as copyright
           FROM media_files WHERE id = $1 AND mime_type LIKE 'image/%'`,
          [share.media_id]
        );
        if (singleRes.rows[0]) {
          mediaMap.set(singleRes.rows[0].id, singleRes.rows[0]);
        }
      } else if (share.folder_path) {
        const folderRes = await query(
          `SELECT id, folder_path, file_name, mime_type, created_at,
                  exif_json->>'DateTimeOriginal' as captured_at,
                  exif_json->>'Make' as camera_make,
                  exif_json->>'Model' as camera_model,
                  exif_json->>'LensModel' as lens_model,
                  exif_json->>'ISO' as iso,
                  exif_json->>'ExposureTime' as shutter_speed,
                  exif_json->>'FNumber' as f_number,
                  exif_json->>'Copyright' as copyright
           FROM media_files
           WHERE (folder_path = $1 OR folder_path LIKE $1 || '/%')
             AND mime_type LIKE 'image/%'
           ORDER BY created_at DESC`,
          [share.folder_path]
        );
        for (const row of folderRes.rows) {
          mediaMap.set(row.id, row);
        }
      }
    }

    const tplVersion = template.updated_at ? new Date(template.updated_at).getTime() : Date.now();
    const cache1080Dir = path.resolve(CACHE_ROOT, '1080p');
    const cache480Dir = path.resolve(CACHE_ROOT, '480p');
    const use480p = !template.allow_hd_download && template.restricted_tier === '500px';

    let regeneratedCount = 0;
    const mediaList = Array.from(mediaMap.values());
    console.log(`[WatermarkRegen] Starting background regeneration of ${mediaList.length} photos for template "${template.name}"...`);

    // Process in batches of 4 concurrency
    const BATCH_SIZE = 4;
    for (let i = 0; i < mediaList.length; i += BATCH_SIZE) {
      const batch = mediaList.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (file) => {
          try {
            let baseDir = use480p ? cache480Dir : cache1080Dir;
            let basePath = path.resolve(baseDir, `${file.id}.webp`);
            if (!fs.existsSync(basePath)) {
              basePath = path.resolve(cache1080Dir, `${file.id}.webp`);
              if (!fs.existsSync(basePath)) {
                basePath = path.resolve(cache480Dir, `${file.id}.webp`);
                if (!fs.existsSync(basePath)) {
                  basePath = path.join(MEDIA_ROOT, file.folder_path, file.file_name);
                  if (!fs.existsSync(basePath)) return;
                }
              }
            }

            const buffer = await this.addWatermarkToStream(basePath, template, file, 'webp');
            const targetPath = path.resolve(wmCacheDir, `${file.id}_${template.id}_${tplVersion}.webp`);
            await fs.promises.writeFile(targetPath, buffer);
            CacheTrackerService.recordWrite('watermark_previews', buffer.length).catch(() => {});
            regeneratedCount++;
          } catch (err) {
            console.error(`[WatermarkRegen] Failed to pre-render media ${file.id}:`, err);
          }
        })
      );
    }

    console.log(`[WatermarkRegen] Completed: regenerated ${regeneratedCount}/${mediaList.length} photos (purged ${purgedCount} old cache files).`);
    return { success: true, purged: purgedCount, regenerated: regeneratedCount };
  }

  /**
   * Purge old cached preview files and regenerate watermarked photos for a specific folder
   */
  static async regenerateFolderWatermarks(folderPath: string): Promise<{ success: boolean; purged: number; regenerated: number; filesCount: number }> {
    const wmCacheDir = path.resolve(CACHE_ROOT, 'watermark_previews');
    if (!fs.existsSync(wmCacheDir)) {
      fs.mkdirSync(wmCacheDir, { recursive: true });
    }

    // 1. Fetch all media files in this folder
    const folder = (folderPath || '').trim();
    let mediaResult;
    if (!folder) {
      mediaResult = await query(
        `SELECT id, folder_path, file_name, mime_type, created_at,
                exif_json->>'DateTimeOriginal' as captured_at,
                exif_json->>'Make' as camera_make,
                exif_json->>'Model' as camera_model,
                exif_json->>'LensModel' as lens_model,
                exif_json->>'ISO' as iso,
                exif_json->>'ExposureTime' as shutter_speed,
                exif_json->>'FNumber' as f_number,
                exif_json->>'Copyright' as copyright
         FROM media_files
         WHERE mime_type LIKE 'image/%'
         ORDER BY created_at DESC`
      );
    } else {
      mediaResult = await query(
        `SELECT id, folder_path, file_name, mime_type, created_at,
                exif_json->>'DateTimeOriginal' as captured_at,
                exif_json->>'Make' as camera_make,
                exif_json->>'Model' as camera_model,
                exif_json->>'LensModel' as lens_model,
                exif_json->>'ISO' as iso,
                exif_json->>'ExposureTime' as shutter_speed,
                exif_json->>'FNumber' as f_number,
                exif_json->>'Copyright' as copyright
         FROM media_files
         WHERE (folder_path = $1 OR folder_path LIKE $2)
           AND mime_type LIKE 'image/%'
         ORDER BY created_at DESC`,
        [folder, `${folder}/%`]
      );
    }

    const mediaList = mediaResult.rows;
    if (mediaList.length === 0) {
      return { success: true, purged: 0, regenerated: 0, filesCount: 0 };
    }

    // 2. Purge cached preview files for these media files
    let purgedCount = 0;
    const mediaIdSet = new Set(mediaList.map((m: any) => m.id));
    try {
      const files = await fs.promises.readdir(wmCacheDir);
      for (const file of files) {
        const parts = file.split('_');
        if (parts.length >= 2 && mediaIdSet.has(parts[0])) {
          await CacheTrackerService.unlinkFile(path.join(wmCacheDir, file)).catch(() => {});
          purgedCount++;
        }
      }
    } catch (err) {
      console.error('[WatermarkFolderRegen] Error purging old cache:', err);
    }

    // 3. Determine applicable templates
    const templatesMap = new Map<string, WatermarkTemplate>();
    const globalSettings = await this.getGlobalEnforcement();
    if (globalSettings.enforceGlobal && globalSettings.globalTemplateId) {
      const globalTpl = await this.getTemplate(globalSettings.globalTemplateId);
      if (globalTpl) {
        templatesMap.set(globalTpl.id, globalTpl);
      }
    }

    // Check shared folders covering this folder
    const sharesQuery = folder
      ? `SELECT DISTINCT watermark_enabled, watermark_template_id
         FROM shared_folders
         WHERE is_active = true
           AND (
             folder_path = $1
             OR folder_path LIKE $1 || '/%'
             OR $1 LIKE folder_path || '/%'
           )`
      : `SELECT DISTINCT watermark_enabled, watermark_template_id
         FROM shared_folders
         WHERE is_active = true`;
    const sharesParams = folder ? [folder] : [];
    const sharesRes = await query(sharesQuery, sharesParams);

    for (const share of sharesRes.rows) {
      if (share.watermark_template_id) {
        const tpl = await this.getTemplate(share.watermark_template_id);
        if (tpl) templatesMap.set(tpl.id, tpl);
      } else if (share.watermark_enabled) {
        const defaultTpl = await this.getDefaultTemplate();
        if (defaultTpl) templatesMap.set(defaultTpl.id, defaultTpl);
      }
    }

    // If no templates mapped yet, fall back to default template
    if (templatesMap.size === 0) {
      const defaultTpl = await this.getDefaultTemplate();
      if (defaultTpl) {
        templatesMap.set(defaultTpl.id, defaultTpl);
      }
    }

    const applicableTemplates = Array.from(templatesMap.values());
    if (applicableTemplates.length === 0) {
      console.log(`[WatermarkFolderRegen] No applicable watermark templates found for folder "${folder}". Purged ${purgedCount} cached files.`);
      return { success: true, purged: purgedCount, regenerated: 0, filesCount: mediaList.length };
    }

    // Touch updated_at on all applicable templates so version/ETag change and browsers instantly fetch new images
    const templateIds = applicableTemplates.map(t => t.id);
    if (templateIds.length > 0) {
      await query(
        `UPDATE watermark_templates SET updated_at = NOW() WHERE id = ANY($1::uuid[])`,
        [templateIds]
      );
      for (const tpl of applicableTemplates) {
        const fresh = await this.getTemplate(tpl.id);
        if (fresh) Object.assign(tpl, fresh);
      }
    }

    // 4. Pre-render watermarked previews for each template
    let regeneratedCount = 0;
    const cache1080Dir = path.resolve(CACHE_ROOT, '1080p');
    const cache480Dir = path.resolve(CACHE_ROOT, '480p');

    for (const template of applicableTemplates) {
      const tplVersion = template.updated_at ? new Date(template.updated_at).getTime() : Date.now();
      const use480p = !template.allow_hd_download && template.restricted_tier === '500px';

      const BATCH_SIZE = 4;
      for (let i = 0; i < mediaList.length; i += BATCH_SIZE) {
        const batch = mediaList.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (file: any) => {
            try {
              let baseDir = use480p ? cache480Dir : cache1080Dir;
              let basePath = path.resolve(baseDir, `${file.id}.webp`);
              if (!fs.existsSync(basePath)) {
                basePath = path.resolve(cache1080Dir, `${file.id}.webp`);
                if (!fs.existsSync(basePath)) {
                  basePath = path.resolve(cache480Dir, `${file.id}.webp`);
                  if (!fs.existsSync(basePath)) {
                    basePath = path.join(MEDIA_ROOT, file.folder_path, file.file_name);
                    if (!fs.existsSync(basePath)) return;
                  }
                }
              }

              const buffer = await this.addWatermarkToStream(basePath, template, file, 'webp');
              const targetPath = path.resolve(wmCacheDir, `${file.id}_${template.id}_${tplVersion}.webp`);
              await fs.promises.writeFile(targetPath, buffer);
              CacheTrackerService.recordWrite('watermark_previews', buffer.length).catch(() => {});
              regeneratedCount++;
            } catch (err) {
              console.error(`[WatermarkFolderRegen] Failed to pre-render media ${file.id}:`, err);
            }
          })
        );
      }
    }

    console.log(`[WatermarkFolderRegen] Completed folder "${folder}": regenerated ${regeneratedCount} items across ${applicableTemplates.length} template(s), purged ${purgedCount} files.`);
    return { success: true, purged: purgedCount, regenerated: regeneratedCount, filesCount: mediaList.length };
  }

  static async deleteTemplate(id: string): Promise<boolean> {
    // Purge cached files for this template
    try {
      const wmCacheDir = path.resolve(CACHE_ROOT, 'watermark_previews');
      if (fs.existsSync(wmCacheDir)) {
        const files = await fs.promises.readdir(wmCacheDir);
        for (const file of files) {
          if (file.includes(`_${id}_`)) {
            await CacheTrackerService.unlinkFile(path.join(wmCacheDir, file)).catch(() => {});
          }
        }
      }
    } catch {}

    // Unassign from shared folders first
    await query(`UPDATE shared_folders SET watermark_template_id = NULL WHERE watermark_template_id = $1`, [id]);
    const res = await query(`DELETE FROM watermark_templates WHERE id = $1`, [id]);
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Determine the effective watermark template for a share request
   */
  static async getEffectiveTemplateForShare(shareToken?: string): Promise<WatermarkTemplate | null> {
    const { enforceGlobal, globalTemplateId } = await this.getGlobalEnforcement();

    if (enforceGlobal) {
      if (globalTemplateId) {
        const globalTpl = await this.getTemplate(globalTemplateId);
        if (globalTpl) return globalTpl;
      }
      return await this.getDefaultTemplate();
    }

    if (!shareToken) return null;

    const { rows } = await query(
      `SELECT watermark_enabled, watermark_template_id FROM shared_folders WHERE share_token = $1`,
      [shareToken]
    );

    if (rows.length === 0) return null;
    const share = rows[0];

    if (!share.watermark_enabled && !share.watermark_template_id) {
      return null;
    }

    if (share.watermark_template_id) {
      const tpl = await this.getTemplate(share.watermark_template_id);
      if (tpl) return tpl;
    }

    if (share.watermark_enabled) {
      return await this.getDefaultTemplate();
    }

    return null;
  }

  /**
   * Replace dynamic EXIF tokens with real metadata
   */
  static replaceTokens(text: string, metadata?: any): string {
    const now = new Date();
    const capturedDate = metadata?.captured_at ? new Date(metadata.captured_at) : now;
    const year = isNaN(capturedDate.getFullYear()) ? now.getFullYear().toString() : capturedDate.getFullYear().toString();
    const dateStr = isNaN(capturedDate.getTime()) ? now.toISOString().split('T')[0] : capturedDate.toISOString().split('T')[0];

    const fileName = metadata?.file_name || 'Photo';
    const title = metadata?.title || fileName.replace(/\.[^/.]+$/, '');
    const folder = metadata?.folder_path ? path.basename(metadata.folder_path) : '';
    const camera = [metadata?.camera_make, metadata?.camera_model].filter(Boolean).join(' ') || '';
    const lens = metadata?.lens_model || '';
    const iso = metadata?.iso ? `ISO ${metadata.iso}` : '';
    const shutter = metadata?.shutter_speed || '';
    const aperture = metadata?.f_number ? `f/${metadata.f_number}` : '';
    const copyright = metadata?.copyright || 'hellomyphotos';

    const tokenMap: Record<string, string> = {
      '{filename}': fileName,
      '{title}': title,
      '{folder}': folder,
      '{year}': year,
      '{date}': dateStr,
      '{camera}': camera,
      '{lens}': lens,
      '{iso}': iso,
      '{shutter}': shutter,
      '{aperture}': aperture,
      '{copyright}': copyright
    };

    return text.replace(/{([a-zA-Z0-9_]+)}/g, (match) => {
      return tokenMap[match] !== undefined ? tokenMap[match] : match;
    });
  }

  /**
   * Escape XML entities
   */
  private static escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Calculate SVG markup for text watermark
   */
  static buildTextSvg(
    template: WatermarkTemplate,
    canvasWidth: number,
    canvasHeight: number,
    metadata?: any
  ): { svg: string; width: number; height: number } {
    const rawText = this.replaceTokens(template.text_content, metadata);
    const lines = rawText.split('\n');
    const maxLineChars = Math.max(...lines.map(l => l.length), 1);

    // Calculate font size based on scale_mode and actual image dimensions
    let fontSize = 32;
    const longEdge = Math.max(canvasWidth, canvasHeight);
    const shortEdge = Math.min(canvasWidth, canvasHeight);
    const scaleVal = template.scale_value != null ? Number(template.scale_value) : 15;

    if (template.scale_mode === 'exact_px') {
      fontSize = Math.round(scaleVal || 28);
    } else if (template.scale_mode === 'proportional_short_edge') {
      fontSize = Math.round(shortEdge * (scaleVal / 350));
    } else if (template.scale_mode === 'fit' || template.scale_mode === 'fill') {
      const maxW = Math.max(80, canvasWidth * 0.85);
      const estFit = Math.round(maxW / (maxLineChars * 0.52 || 1));
      const propSize = Math.round(longEdge * (scaleVal / 500));
      fontSize = Math.min(estFit, propSize);
    } else {
      // proportional_long_edge default
      fontSize = Math.round(longEdge * (scaleVal / 500));
    }

    fontSize = Math.max(4, Math.min(fontSize, Math.round(canvasHeight * 0.4)));

    const letterSpacing = Number(template.letter_spacing) || 0;
    const lineSpacingMultiplier = template.line_spacing || 1.2;
    const lineHeight = Math.round(fontSize * lineSpacingMultiplier);
    const textBlockHeight = lines.length * lineHeight;
    const textBlockWidth = Math.round(maxLineChars * (fontSize * 0.52 + letterSpacing));

    const padX = template.bg_box_enabled ? Math.max(Number(template.bg_box_padding_x) || 12, 4) : 0;
    const padY = template.bg_box_enabled ? Math.max(Number(template.bg_box_padding_y) || 8, 4) : 0;
    const shadowMargin = template.shadow_enabled
      ? Math.max(Math.abs(template.shadow_offset_x || 2), Math.abs(template.shadow_offset_y || 2)) + (template.shadow_radius || 4) * 2 + 4
      : 0;

    const contentWidth = textBlockWidth + (padX * 2);
    const contentHeight = textBlockHeight + (padY * 2);

    const overlayWidth = contentWidth + (shadowMargin * 2);
    const overlayHeight = contentHeight + (shadowMargin * 2);

    // Text anchor in SVG
    const align = template.text_align || 'center';
    let textAnchor = 'middle';
    let textX = shadowMargin + padX + Math.round(textBlockWidth / 2);
    if (align === 'left') {
      textAnchor = 'start';
      textX = shadowMargin + padX;
    } else if (align === 'right') {
      textAnchor = 'end';
      textX = shadowMargin + padX + textBlockWidth;
    }

    // Shadow filter
    let shadowFilterDef = '';
    let filterAttr = '';
    if (template.shadow_enabled) {
      const sDx = template.shadow_offset_x ?? 2;
      const sDy = template.shadow_offset_y ?? 2;
      const sRadius = template.shadow_radius ?? 4;
      const sColor = template.shadow_color || '#000000';
      const sOpacity = template.shadow_opacity ?? 0.75;

      shadowFilterDef = `
        <filter id="wm-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="${sDx}" dy="${sDy}" stdDeviation="${sRadius}" flood-color="${sColor}" flood-opacity="${sOpacity}" />
        </filter>
      `;
      filterAttr = 'filter="url(#wm-shadow)"';
    }

    // Background box
    let bgBoxSvg = '';
    if (template.bg_box_enabled) {
      const boxX = shadowMargin;
      const boxY = shadowMargin;
      const boxW = contentWidth;
      const boxH = contentHeight;
      const radius = template.bg_box_border_radius ?? 6;
      const bgColor = template.bg_box_color || '#000000';
      const bgOpacity = template.bg_box_opacity ?? 0.5;

      bgBoxSvg = `
        <rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="${radius}" fill="${bgColor}" fill-opacity="${bgOpacity}" ${filterAttr} />
      `;
    }

    // Text tspans
    const startY = shadowMargin + padY;
    const tspans = lines
      .map((line, idx) => {
        const y = startY + idx * lineHeight;
        return `<tspan x="${textX}" y="${y}" dominant-baseline="hanging">${this.escapeXml(line)}</tspan>`;
      })
      .join('\n');

    const fontFamily = template.font_family || 'Instrument Sans';
    const fontWeight = template.font_weight || 'bold';
    const fontStyle = template.font_style || 'normal';
    const fontColor = template.font_color || '#ffffff';
    const letterSpacingStr = template.letter_spacing ? `${template.letter_spacing}px` : '0px';

    const masterOpacity = template.opacity ?? 0.85;

    // Rotation transform
    const rawRotation = Number(template.rotation) || 0;
    const rotation = ((rawRotation % 360) + 360) % 360;

    let svgW = overlayWidth;
    let svgH = overlayHeight;
    let transformAttr = '';

    if (rotation === 90) {
      svgW = overlayHeight;
      svgH = overlayWidth;
      transformAttr = `transform="translate(${overlayHeight}, 0) rotate(90)"`;
    } else if (rotation === 180) {
      transformAttr = `transform="translate(${overlayWidth}, ${overlayHeight}) rotate(180)"`;
    } else if (rotation === 270) {
      svgW = overlayHeight;
      svgH = overlayWidth;
      transformAttr = `transform="translate(0, ${overlayWidth}) rotate(270)"`;
    } else if (rotation !== 0) {
      transformAttr = `transform="rotate(${rotation}, ${overlayWidth / 2}, ${overlayHeight / 2})"`;
    }

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}">
        <defs>
          ${shadowFilterDef}
        </defs>
        <g opacity="${masterOpacity}" ${transformAttr}>
          ${bgBoxSvg}
          <text
            x="${textX}"
            y="${startY}"
            text-anchor="${textAnchor}"
            font-family="${fontFamily}"
            font-weight="${fontWeight}"
            font-style="${fontStyle}"
            font-size="${fontSize}"
            fill="${fontColor}"
            letter-spacing="${letterSpacingStr}"
            ${!template.bg_box_enabled && template.shadow_enabled ? filterAttr : ''}
          >
            ${tspans}
          </text>
        </g>
      </svg>
    `;

    return { svg, width: svgW, height: svgH };
  }

  /**
   * Build full-canvas tiled SVG for proofing protection
   */
  static buildTiledSvg(
    template: WatermarkTemplate,
    canvasWidth: number,
    canvasHeight: number,
    metadata?: any
  ): string {
    const rawText = this.replaceTokens(template.text_content, metadata);
    const lines = rawText.split('\n').filter(Boolean);
    const textToShow = lines.length > 0 ? lines : ['PROOF'];
    const maxLineLen = Math.max(...textToShow.map(l => l.length), 5);
    const opacity = template.opacity ?? 0.5;
    const fontColor = template.font_color || '#ffffff';
    const fontFamily = template.font_family || 'Instrument Sans';
    const fontWeight = template.font_weight || 'bold';
    const fontStyle = template.font_style || 'normal';

    const tileWidth = Math.max(340, Math.round(maxLineLen * 18) + 80);
    const tileHeight = Math.max(220, textToShow.length * 36 + 140);
    const midX = Math.round(tileWidth / 2);
    const lineHeight = 36;
    const startY = Math.round(tileHeight / 2) - Math.round(((textToShow.length - 1) * lineHeight) / 2);
    const rotation = template.rotation !== 0 ? template.rotation : -30;

    const tspans = textToShow.map((l, i) => 
      `<tspan x="${midX}" y="${startY + i * lineHeight}">${this.escapeXml(l)}</tspan>`
    ).join('\n');

    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">
        <defs>
          <pattern id="wm-tile" width="${tileWidth}" height="${tileHeight}" patternUnits="userSpaceOnUse" patternTransform="rotate(${rotation})">
            <text
              x="${midX}"
              y="${startY}"
              text-anchor="middle"
              dominant-baseline="middle"
              font-family="${fontFamily}"
              font-weight="${fontWeight}"
              font-style="${fontStyle}"
              font-size="28"
              fill="${fontColor}"
              fill-opacity="${opacity}"
              stroke="#000000"
              stroke-width="1"
              stroke-opacity="${opacity * 0.8}"
            >
              ${tspans}
            </text>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#wm-tile)" />
      </svg>
    `;
  }

  /**
   * Apply watermark to an image buffer or file path
   */
  static async addWatermarkToStream(
    imagePath: string,
    templateOverride?: WatermarkTemplate | null,
    metadata?: any,
    targetFormat: 'webp' | 'jpeg' | 'png' = 'webp'
  ): Promise<Buffer> {
    const resolvedPath = path.resolve(imagePath);
    if (!resolvedPath.startsWith(CACHE_ROOT) && !resolvedPath.startsWith(MEDIA_ROOT)) {
      throw new Error('Access denied to image path');
    }

    try {
      const template = templateOverride || await this.getDefaultTemplate();
      const image = sharp(resolvedPath);
      const meta = await image.metadata();
      const canvasWidth = meta.width || 1920;
      const canvasHeight = meta.height || 1080;

      const encodeOutput = async (pipeline: any) => {
        if (targetFormat === 'jpeg') {
          return await pipeline.jpeg({ quality: 90 }).toBuffer();
        } else if (targetFormat === 'png') {
          return await pipeline.png().toBuffer();
        } else {
          return await pipeline.webp({ quality: 85 }).toBuffer();
        }
      };

      // Handle Tiled Mode
      if (template.is_tiled) {
        const tiledSvg = this.buildTiledSvg(template, canvasWidth, canvasHeight, metadata);
        const resvg = new Resvg(tiledSvg, {
          font: {
            fontDirs: [FONTS_DIR],
            defaultFontFamily: template.font_family || 'Instrument Sans'
          }
        });
        const tiledPng = resvg.render().asPng();

        return await encodeOutput(image.composite([{ input: tiledPng, top: 0, left: 0 }]));
      }

      // Handle Image Logo Watermark
      if (template.type === 'image' && template.image_path) {
        const logoFullPath = path.resolve(CACHE_ROOT, template.image_path);
        if (fs.existsSync(logoFullPath)) {
          const scaleVal = template.scale_value != null ? Number(template.scale_value) : 15;
          let targetW = Math.round(canvasWidth * (scaleVal / 100));
          targetW = Math.max(targetW, 10);

          let logoPipeline = sharp(logoFullPath)
            .resize({ width: targetW, withoutEnlargement: false })
            .ensureAlpha();

          const rawRot = Number(template.rotation) || 0;
          const rot = ((rawRot % 360) + 360) % 360;
          if (rot !== 0) {
            logoPipeline = logoPipeline.rotate(rot);
          }

          const logoBuffer = await logoPipeline.toBuffer();

          const logoMeta = await sharp(logoBuffer).metadata();
          const logoW = logoMeta.width || targetW;
          const logoH = logoMeta.height || targetW;

          const logoTrimmed = await sharp(logoBuffer)
            .trim()
            .toBuffer({ resolveWithObject: true })
            .catch(() => ({ data: logoBuffer, info: { width: logoW, height: logoH } }));

          const { top, left } = this.calculatePosition(
            template.anchor,
            template.inset_x,
            template.inset_y,
            canvasWidth,
            canvasHeight,
            logoTrimmed.info.width,
            logoTrimmed.info.height
          );

          return await encodeOutput(image.composite([{ input: logoTrimmed.data, top, left }]));
        }
      }

      // Handle Text Watermark (Default)
      const { svg, width: wmWidth, height: wmHeight } = this.buildTextSvg(
        template,
        canvasWidth,
        canvasHeight,
        metadata
      );

      const resvg = new Resvg(svg, {
        font: {
          fontDirs: [FONTS_DIR],
          defaultFontFamily: template.font_family || 'Instrument Sans'
        }
      });
      const wmPng = resvg.render().asPng();
      const { data: trimmedPng, info: trimInfo } = await sharp(wmPng)
        .trim()
        .toBuffer({ resolveWithObject: true });

      const { top, left } = this.calculatePosition(
        template.anchor,
        template.inset_x,
        template.inset_y,
        canvasWidth,
        canvasHeight,
        trimInfo.width,
        trimInfo.height
      );

      return await encodeOutput(image.composite([{ input: trimmedPng, top, left }]));
    } catch (error) {
      console.error('[WatermarkService] Failed to apply watermark, falling back to original:', error);
      return fs.promises.readFile(resolvedPath);
    }
  }

  /**
   * Calculate top/left anchor positions based on 9-point grid and edge insets
   */
  private static calculatePosition(
    anchor: string,
    insetXPct: number,
    insetYPct: number,
    canvasW: number,
    canvasH: number,
    wmW: number,
    wmH: number
  ): { top: number; left: number } {
    const insetX = Math.round(canvasW * ((insetXPct ?? 3) / 100));
    const insetY = Math.round(canvasH * ((insetYPct ?? 3) / 100));

    let top = 0;
    let left = 0;

    switch (anchor) {
      case 'top-left':
        left = insetX;
        top = insetY;
        break;
      case 'top-center':
        left = Math.round((canvasW - wmW) / 2);
        top = insetY;
        break;
      case 'top-right':
        left = canvasW - wmW - insetX;
        top = insetY;
        break;
      case 'middle-left':
        left = insetX;
        top = Math.round((canvasH - wmH) / 2);
        break;
      case 'center':
        left = Math.round((canvasW - wmW) / 2);
        top = Math.round((canvasH - wmH) / 2);
        break;
      case 'middle-right':
        left = canvasW - wmW - insetX;
        top = Math.round((canvasH - wmH) / 2);
        break;
      case 'bottom-left':
        left = insetX;
        top = canvasH - wmH - insetY;
        break;
      case 'bottom-center':
        left = Math.round((canvasW - wmW) / 2);
        top = canvasH - wmH - insetY;
        break;
      case 'bottom-right':
      default:
        left = canvasW - wmW - insetX;
        top = canvasH - wmH - insetY;
        break;
    }

    // Clamp coordinates within canvas boundaries
    left = Math.max(0, Math.min(left, Math.max(0, canvasW - wmW)));
    top = Math.max(0, Math.min(top, Math.max(0, canvasH - wmH)));

    return { top, left };
  }

  /**
   * Render a sample preview on-the-fly for the Admin studio
   */
  static async renderPreviewSample(
    templatePartial: Partial<WatermarkTemplate>,
    sampleType: 'dark' | 'light' | 'portrait' | 'landscape' = 'landscape',
    mediaId?: string
  ): Promise<Buffer> {
    let width = 1200;
    let height = 800;
    let baseImage: Buffer | null = null;
    let sampleMetadata: any = {
      file_name: 'DSC_0842.JPG',
      title: 'Studio Portrait Session',
      folder_path: 'Clients/2026/Wedding',
      captured_at: new Date().toISOString(),
      camera_make: 'Sony',
      camera_model: 'ILCE-7M4',
      lens_model: 'FE 24-70mm F2.8 GM II',
      iso: 400,
      shutter_speed: '1/250s',
      f_number: 2.8,
      copyright: 'hellomyphotos'
    };

    if (mediaId) {
      try {
        const { rows } = await query(
          `SELECT id, file_name, folder_path, 
                  COALESCE(img_width, (exif_json->>'width')::int, 1200) as img_width, 
                  COALESCE(img_height, (exif_json->>'height')::int, 800) as img_height, 
                  created_at, 
                  exif_json->>'Make' as camera_make, 
                  exif_json->>'Model' as camera_model, 
                  exif_json->>'LensModel' as lens_model, 
                  exif_json->>'ISO' as iso, 
                  exif_json->>'ExposureTime' as shutter_speed, 
                  exif_json->>'FNumber' as f_number, 
                  exif_json->>'Copyright' as copyright 
           FROM media_files WHERE id = $1`,
          [mediaId]
        );
        if (rows.length > 0) {
          const row = rows[0];
          const cache1080 = path.join(CACHE_ROOT, '1080p', `${row.id}.webp`);
          const cache480 = path.join(CACHE_ROOT, '480p', `${row.id}.webp`);
          const orig = path.join(MEDIA_ROOT, row.folder_path, row.file_name);
          const targetFile = fs.existsSync(cache1080) ? cache1080 : (fs.existsSync(cache480) ? cache480 : (fs.existsSync(orig) ? orig : null));

          if (targetFile) {
            const meta = await sharp(targetFile).metadata();
            width = meta.width || row.img_width || 1200;
            height = meta.height || row.img_height || 800;
            baseImage = await fs.promises.readFile(targetFile);
            sampleMetadata = { ...sampleMetadata, ...row };
          }
        }
      } catch (err) {
        console.error('[WatermarkService] Failed to load sample media photo:', err);
      }
    }

    if (!baseImage) {
      const isPortrait = sampleType === 'portrait';
      width = isPortrait ? 800 : 1200;
      height = isPortrait ? 1200 : 800;

      const bgColors = {
        dark: { r: 24, g: 24, b: 27 },
        light: { r: 240, g: 242, b: 245 },
        portrait: { r: 35, g: 45, b: 60 },
        landscape: { r: 30, g: 41, b: 59 }
      };

      const bg = bgColors[sampleType] || bgColors.landscape;

      baseImage = await sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { ...bg, alpha: 1 }
        }
      })
      .png()
      .toBuffer();
    }

    const fullTemplate: WatermarkTemplate = {
      ...(await this.getDefaultTemplate()),
      ...templatePartial
    };

    // Build SVG
    if (fullTemplate.is_tiled) {
      const tiledSvg = this.buildTiledSvg(fullTemplate, width, height, sampleMetadata);
      const resvg = new Resvg(tiledSvg, {
        font: {
          fontDirs: [FONTS_DIR],
          defaultFontFamily: fullTemplate.font_family || 'Instrument Sans'
        }
      });
      const tiledPng = resvg.render().asPng();

      return await sharp(baseImage)
        .composite([{ input: tiledPng, top: 0, left: 0 }])
        .webp()
        .toBuffer();
    }

    const { svg, width: wmW, height: wmH } = this.buildTextSvg(
      fullTemplate,
      width,
      height,
      sampleMetadata
    );

    const resvg = new Resvg(svg, {
      font: {
        fontDirs: [FONTS_DIR],
        defaultFontFamily: fullTemplate.font_family || 'Instrument Sans'
      }
    });
    const wmPng = resvg.render().asPng();
    const { data: trimmedPng, info: trimInfo } = await sharp(wmPng)
      .trim()
      .toBuffer({ resolveWithObject: true });

    const { top, left } = this.calculatePosition(
      fullTemplate.anchor,
      fullTemplate.inset_x,
      fullTemplate.inset_y,
      width,
      height,
      trimInfo.width,
      trimInfo.height
    );

    return await sharp(baseImage)
      .composite([{ input: trimmedPng, top, left }])
      .webp()
      .toBuffer();
  }

  private static mapRowToTemplate(row: any): WatermarkTemplate {
    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      is_default: Boolean(row.is_default),
      type: row.type || 'text',
      text_content: row.text_content ?? '© {year} {copyright}',
      font_family: row.font_family || 'Instrument Sans',
      font_weight: row.font_weight || 'bold',
      font_style: row.font_style || 'normal',
      font_color: row.font_color || '#ffffff',
      text_align: row.text_align || 'center',
      letter_spacing: Number(row.letter_spacing) || 0,
      line_spacing: Number(row.line_spacing) || 1.2,
      image_path: row.image_path || null,
      shadow_enabled: Boolean(row.shadow_enabled),
      shadow_color: row.shadow_color || '#000000',
      shadow_opacity: Number(row.shadow_opacity) ?? 0.75,
      shadow_radius: Number(row.shadow_radius) ?? 4,
      shadow_offset_x: Number(row.shadow_offset_x) ?? 2,
      shadow_offset_y: Number(row.shadow_offset_y) ?? 2,
      bg_box_enabled: Boolean(row.bg_box_enabled),
      bg_box_color: row.bg_box_color || '#000000',
      bg_box_opacity: Number(row.bg_box_opacity) ?? 0.5,
      bg_box_padding_x: Number(row.bg_box_padding_x) ?? 12,
      bg_box_padding_y: Number(row.bg_box_padding_y) ?? 8,
      bg_box_border_radius: Number(row.bg_box_border_radius) ?? 6,
      anchor: row.anchor || 'bottom-right',
      inset_x: Number(row.inset_x) ?? 3,
      inset_y: Number(row.inset_y) ?? 3,
      scale_mode: row.scale_mode || 'proportional_long_edge',
      scale_value: Number(row.scale_value) ?? 15,
      rotation: Number(row.rotation) ?? 0,
      opacity: Number(row.opacity) ?? 0.85,
      is_tiled: Boolean(row.is_tiled),
      allow_hd_download: Boolean(row.allow_hd_download),
      restricted_tier: row.restricted_tier || '1080p',
      apply_to_previews: row.apply_to_previews !== false,
      apply_to_downloads: row.apply_to_downloads !== false,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}
