import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

import { query } from '../../config/db';

export class WatermarkService {
  static async getSettings() {
    const { rows } = await query(`SELECT key, value FROM admin_settings WHERE key IN ('watermark_text', 'watermark_opacity', 'watermark_position', 'watermark_enforce_global')`);
    let text = 'hellomyphotos';
    let opacity = 0.5;
    let position = 'center';
    let enforceGlobal = false;
    
    for (const r of rows) {
      if (r.key === 'watermark_text') text = typeof r.value === 'string' ? r.value : r.value;
      if (r.key === 'watermark_opacity') opacity = Number(r.value) || 0.5;
      if (r.key === 'watermark_position') position = typeof r.value === 'string' ? r.value : r.value;
      if (r.key === 'watermark_enforce_global') enforceGlobal = r.value === true || r.value === 'true';
    }
    
    return { text, opacity, position, enforceGlobal };
  }

  static async addWatermarkToStream(imagePath: string): Promise<Buffer> {
    try {
      const settings = await this.getSettings();
      
      let svgOverlay = '';
      
      if (settings.position === 'tiled') {
        svgOverlay = `
          <svg width="800" height="800">
            <defs>
              <pattern id="pattern1" width="300" height="300" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                <text x="50%" y="50%" text-anchor="middle" font-family="Arial" font-size="36" fill="rgba(255, 255, 255, ${settings.opacity})" stroke="rgba(0, 0, 0, ${settings.opacity + 0.1})" stroke-width="1">
                  ${settings.text}
                </text>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#pattern1)" />
          </svg>
        `;
      } else {
        const isBottom = settings.position === 'bottom-right';
        const isTop = settings.position === 'top-left';
        
        const x = isBottom ? '95%' : isTop ? '5%' : '50%';
        const y = isBottom ? '95%' : isTop ? '10%' : '50%';
        const anchor = isBottom ? 'end' : isTop ? 'start' : 'middle';
        
        svgOverlay = `
          <svg width="1000" height="1000">
            <text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Arial" font-size="64" fill="rgba(255, 255, 255, ${settings.opacity})" stroke="rgba(0, 0, 0, ${settings.opacity + 0.1})" stroke-width="2">
              ${settings.text}
            </text>
          </svg>
        `;
      }

      return await sharp(imagePath)
        .composite([
          {
            input: Buffer.from(svgOverlay),
            gravity: settings.position === 'bottom-right' ? 'southeast' : settings.position === 'top-left' ? 'northwest' : 'center',
            tile: settings.position === 'tiled'
          }
        ])
        .webp()
        .toBuffer();
    } catch (error) {
      console.error('[Watermark] Failed to apply watermark', error);
      return fs.promises.readFile(imagePath);
    }
  }
}
