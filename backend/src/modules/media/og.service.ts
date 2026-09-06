import fs from 'fs';
import path from 'path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { query } from '../../config/db';
import { computeCoverObjectPosition } from './cover.utils';

const CACHE_DIR = path.resolve(process.env.MEDIA_ROOT || '/app/media', '../cache/og');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// Load font synchronously on startup
const fontPath = path.join(import.meta.dirname, '../../assets/fonts/CabinetGrotesk-Bold.otf');
const fontData = fs.existsSync(fontPath) ? fs.readFileSync(fontPath) : null;

const subheadingFontPath = path.join(import.meta.dirname, '../../assets/fonts/InstrumentSans-Medium.ttf');
const subheadingFontData = fs.existsSync(subheadingFontPath) ? fs.readFileSync(subheadingFontPath) : null;

export class OgService {
  static async generateForFolder(token: string, folderPath: string): Promise<string> {
    const safePath = folderPath.replace(/[^a-zA-Z0-9-_\.]/g, '_');
    const cachePath = path.join(CACHE_DIR, `${token}_${safePath}.png`);

    if (fs.existsSync(cachePath)) {
      return cachePath;
    }

    // Fetch share details to ensure it exists and get base folder path
    const shareRes = await query(`SELECT folder_path FROM shared_folders WHERE share_token = $1`, [token]);
    if (shareRes.rows.length === 0) throw new Error('Share not found');
    const baseFolderPath = shareRes.rows[0].folder_path;

    // Get explicit cover info
    const folderRes = await query(`
      SELECT COALESCE(fs.cover_media_id, fs.auto_cover_media_id) as cover_media_id,
             (SELECT bounding_box FROM face_embeddings WHERE media_id = COALESCE(fs.cover_media_id, fs.auto_cover_media_id) LIMIT 1) as bounding_box,
             COALESCE(m.img_width, (m.exif_json->>'width')::int) as img_width,
             COALESCE(m.img_height, (m.exif_json->>'height')::int) as img_height
      FROM folder_settings fs
      LEFT JOIN media_files m ON m.id = COALESCE(fs.cover_media_id, fs.auto_cover_media_id)
      WHERE fs.folder_path = $1
    `, [folderPath]);
    
    let coverId = folderRes.rows.length > 0 ? folderRes.rows[0].cover_media_id : null;
    let bb = folderRes.rows.length > 0 ? folderRes.rows[0].bounding_box : null;
    let imgW = folderRes.rows.length > 0 ? folderRes.rows[0].img_width : null;
    let imgH = folderRes.rows.length > 0 ? folderRes.rows[0].img_height : null;

    if (!coverId) {
      // Fallback to first item in folder
      const fallbackRes = await query(`
        SELECT m.id, (SELECT bounding_box FROM face_embeddings WHERE media_id = m.id LIMIT 1) as bounding_box,
               COALESCE(m.img_width, (m.exif_json->>'width')::int) as img_width,
               COALESCE(m.img_height, (m.exif_json->>'height')::int) as img_height
        FROM media_files m 
        WHERE m.folder_path = $1 
        ORDER BY m.created_at DESC LIMIT 1
      `, [folderPath]);
      if (fallbackRes.rows.length > 0) {
        coverId = fallbackRes.rows[0].id;
        bb = fallbackRes.rows[0].bounding_box;
        imgW = fallbackRes.rows[0].img_width;
        imgH = fallbackRes.rows[0].img_height;
      }
    }

    let coverBase64 = '';
    if (coverId) {
      const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || path.resolve(process.env.MEDIA_ROOT || '/app/media', '../cache'));
      const thumbnailPath = path.join(CACHE_ROOT, `1080p/${coverId}.webp`);
      
      if (fs.existsSync(thumbnailPath)) {
        try {
          const coverBuf = await sharp(thumbnailPath).jpeg().toBuffer();
          coverBase64 = `data:image/jpeg;base64,${coverBuf.toString('base64')}`;
        } catch (e) {
          console.error('Failed to parse 1080p webp for OG image', e);
        }
      } else {
        const fileRow = await query('SELECT folder_path, file_name FROM media_files WHERE id = $1', [coverId]);
        if (fileRow.rows.length > 0) {
          const MEDIA_ROOT = process.env.MEDIA_ROOT || '/app/media';
          const originalPath = path.join(MEDIA_ROOT, fileRow.rows[0].folder_path || '', fileRow.rows[0].file_name);
          if (fs.existsSync(originalPath)) {
            try {
              const coverBuf = await sharp(originalPath).resize(1080, 1080, { fit: 'cover' }).jpeg().toBuffer();
              coverBase64 = `data:image/jpeg;base64,${coverBuf.toString('base64')}`;
            } catch (e) {
              console.error('Failed to parse original image for OG image', e);
            }
          }
        }
      }
    }

    const objectPosition = computeCoverObjectPosition(bb, imgW, imgH);

    // Build Breadcrumbs
    const parts = folderPath.split('/');
    const folderName = parts.pop() || 'Home';
    let breadcrumbs = '';
    
    if (parts.length > 0) {
      breadcrumbs = parts.join(' > ');
    }

    const svg = await satori(
      {
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            width: '100%',
            height: '100%',
            backgroundColor: '#000',
            position: 'relative',
            fontFamily: 'Cabinet Grotesk'
          },
          children: [
            coverBase64 ? {
              type: 'img',
              props: {
                src: coverBase64,
                style: {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: objectPosition
                }
              }
            } : null,
            {
              type: 'div',
              props: {
                style: {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,1) 100%)'
                }
              }
            },
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '60px',
                  zIndex: 10
                },
                children: [
                  breadcrumbs ? {
                    type: 'div',
                    props: {
                      style: { display: 'flex', fontSize: '32px', color: '#a1a1aa', margin: '0 0 16px 0', fontFamily: 'Instrument Sans', fontWeight: 500 },
                      children: breadcrumbs
                    }
                  } : null,
                  {
                    type: 'h2',
                    props: {
                      style: { display: 'flex', fontSize: '80px', color: '#ffffff', margin: 0, fontWeight: 700, letterSpacing: '-0.02em', fontFamily: 'Cabinet Grotesk' },
                      children: folderName
                    }
                  }
                ]
              }
            }
          ]
        }
      },
      {
        width: 1080,
        height: 1080,
        fonts: [
          ...(fontData ? [{
            name: 'Cabinet Grotesk',
            data: fontData,
            weight: 700,
            style: 'normal',
          } as any] : []),
          ...(subheadingFontData ? [{
            name: 'Instrument Sans',
            data: subheadingFontData,
            weight: 500,
            style: 'normal',
          } as any] : [])
        ]
      }
    );
    
    const resvg = new Resvg(svg);
    const pngData = resvg.render().asPng();
    fs.writeFileSync(cachePath, pngData);
    
    return cachePath;
  }
}
