import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

export class WatermarkService {
  static async addWatermarkToStream(imagePath: string, text: string): Promise<Buffer> {
    try {
      // Create SVG overlay for the watermark
      const svgOverlay = `
        <svg width="400" height="100">
          <text x="50%" y="50%" text-anchor="middle" font-family="Arial" font-size="48" fill="rgba(255, 255, 255, 0.4)" stroke="rgba(0, 0, 0, 0.5)" stroke-width="1">
            ${text}
          </text>
        </svg>
      `;

      return await sharp(imagePath)
        .composite([
          {
            input: Buffer.from(svgOverlay),
            gravity: 'center'
          }
        ])
        .webp()
        .toBuffer();
    } catch (error) {
      console.error('[Watermark] Failed to apply watermark', error);
      // Fallback to unwatermarked buffer if failure occurs
      return fs.promises.readFile(imagePath);
    }
  }
}
