import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { query } from '../../config/db';
import { SmartSearchService } from './smartSearch.service';

const defaultCacheDir = fs.existsSync('/app/cache') ? '/app/cache' : path.resolve(process.cwd(), '../volumes/cache_rw');
const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || defaultCacheDir);
const ML_URL = process.env.IMMICH_ML_URL || 'http://localhost:3003';

const FACE_THUMB_SIZE = 300;
const FACE_PADDING = 0.5;

function parseBoundingBox(box: any): { left: number; top: number; width: number; height: number } {
  if (box && box.x1 !== undefined && box.y1 !== undefined && box.x2 !== undefined && box.y2 !== undefined) {
    const w = box.x2 - box.x1;
    const h = box.y2 - box.y1;
    const padW = w * FACE_PADDING;
    const padH = h * FACE_PADDING;
    return {
      left: Math.max(0, Math.floor(box.x1 - padW)),
      top: Math.max(0, Math.floor(box.y1 - padH)),
      width: Math.ceil(w + padW * 2),
      height: Math.ceil(h + padH * 2),
    };
  }
  if (box && box.x !== undefined && box.y !== undefined && box.w !== undefined && box.h !== undefined) {
    const padW = box.w * FACE_PADDING;
    const padH = box.h * FACE_PADDING;
    return {
      left: Math.max(0, Math.floor(box.x - padW)),
      top: Math.max(0, Math.floor(box.y - padH)),
      width: Math.ceil(box.w + padW * 2),
      height: Math.ceil(box.h + padH * 2),
    };
  }
  return { left: 0, top: 0, width: 100, height: 100 };
}

export class MLService {
  static async detectFaces(mediaId: string, fullPath?: string) {
    try {
      let imagePath = fullPath || '';
      if (!imagePath || !fs.existsSync(imagePath)) {
        const cache480 = path.join(CACHE_ROOT, '480p', `${mediaId}.webp`);
        const cache1080 = path.join(CACHE_ROOT, '1080p', `${mediaId}.webp`);
        if (fs.existsSync(cache480)) {
          imagePath = cache480;
        } else if (fs.existsSync(cache1080)) {
          imagePath = cache1080;
        } else {
          // Look up media file path in DB
          const dbRes = await query(`SELECT folder_path, file_name FROM media_files WHERE id = $1`, [mediaId]);
          if (dbRes.rows.length > 0) {
            const mediaRoot = process.env.MEDIA_ROOT || '/app/media';
            const candidate = path.join(mediaRoot, dbRes.rows[0].folder_path, dbRes.rows[0].file_name);
            if (fs.existsSync(candidate)) {
              imagePath = candidate;
            }
          }
        }
      }

      if (!imagePath || !fs.existsSync(imagePath)) {
        console.warn(`[ML] Image ${mediaId} not found on disk for face detection.`);
        return;
      }

      const imageBuffer = await fs.promises.readFile(imagePath);
      
      // Get image dimensions and store on media_files
      try {
        const meta = await sharp(imagePath).metadata();
        if (meta.width && meta.height) {
          await query(`UPDATE media_files SET img_width = $1, img_height = $2 WHERE id = $3`, [meta.width, meta.height, mediaId]);
        }
      } catch (e) {
        // non-critical
      }
      
      // Constructing multipart form data manually for native fetch simplicity
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      const entriesJson = JSON.stringify({
        "facial-recognition": {
          "recognition": { "modelName": "buffalo_l" },
          "detection": { "modelName": "buffalo_l" }
        }
      });
      
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="entries"\r\n\r\n${entriesJson}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="image.webp"\r\nContent-Type: image/webp\r\n\r\n`),
        imageBuffer,
        Buffer.from(`\r\n--${boundary}--`)
      ]);

      const response = await fetch(`${ML_URL}/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: body as any
      });

      if (!response.ok) {
        throw new Error(`ML container responded with ${response.status}`);
      }

      const data = await response.json();
      // Immich returns an array of bounding boxes and embeddings
      console.log('[ML] Face detection data received for:', mediaId);
      const faceList = data['facial-recognition'] || data.faces || [];
      for (const face of faceList) {
        const { boundingBox, embedding } = face;
        const embeddingString = typeof embedding === 'string' ? embedding : `[${embedding.join(',')}]`;
        
        // Query face_embeddings using pgvector cosine distance (< 0.4) to match existing known identities
        const matchResult = await query(`
          SELECT person_id 
          FROM face_embeddings 
          WHERE person_id IS NOT NULL AND embedding <=> $1::vector < 0.4 
          ORDER BY embedding <=> $1::vector 
          LIMIT 1
        `, [embeddingString]);

        // If matched to an existing person cluster, assign that person_id; otherwise set person_id = NULL for unclustered faces
        const personId = matchResult.rows.length > 0 ? matchResult.rows[0].person_id : null;

        // Insert new face bounding box and embedding vector(512)
        await query(`
          INSERT INTO face_embeddings (media_id, person_id, bounding_box, embedding)
          VALUES ($1, $2, $3, $4::vector)
        `, [mediaId, personId, JSON.stringify(boundingBox), embeddingString]);
      }

    } catch (err: any) {
      console.error(`[ML] Failed to process faces for ${mediaId}:`, err.message);
    }
  }

  static async generateFaceThumbnails(mediaId: string) {
    try {
      const faces = await query(`
        SELECT fe.id, fe.person_id, fe.bounding_box, m.folder_path, m.file_name
        FROM face_embeddings fe
        JOIN media_files m ON m.id = fe.media_id
        WHERE fe.media_id = $1 AND fe.person_id IS NOT NULL
      `, [mediaId]);

      const mediaRoot = process.env.MEDIA_ROOT || '/app/media';
      const outDir = path.join(CACHE_ROOT, 'faces');
      await fs.promises.mkdir(outDir, { recursive: true });

      for (const face of faces.rows) {
        // Only generate if this media is the best for this person (explicit cover or fewest other faces)
        const best = await query(`
          SELECT COALESCE(
            (SELECT cover_media_id FROM people WHERE id = $1 AND cover_media_id IS NOT NULL),
            (SELECT fe2.media_id FROM face_embeddings fe2
              WHERE fe2.person_id = $1
              ORDER BY (SELECT COUNT(*) FROM face_embeddings WHERE media_id = fe2.media_id) ASC,
                (SELECT created_at FROM media_files WHERE id = fe2.media_id) DESC
              LIMIT 1)
          ) AS media_id
        `, [face.person_id]);
        if (best.rows.length === 0 || best.rows[0].media_id !== mediaId) continue;

        const fullPath = path.join(mediaRoot, face.folder_path, face.file_name);
        if (!fs.existsSync(fullPath)) continue;

        const crop = parseBoundingBox(face.bounding_box);
        const outPath = path.join(outDir, `${face.person_id}.webp`);

        const meta = await sharp(fullPath).metadata();
        const imgW = meta.width || 1;
        const imgH = meta.height || 1;
        crop.left = Math.min(crop.left, imgW - 1);
        crop.top = Math.min(crop.top, imgH - 1);
        crop.width = Math.min(crop.width, imgW - crop.left);
        crop.height = Math.min(crop.height, imgH - crop.top);

        await sharp(fullPath)
          .extract(crop)
          .resize(FACE_THUMB_SIZE, FACE_THUMB_SIZE, { fit: 'cover', withoutEnlargement: true })
          .webp({ quality: 75 })
          .toFile(outPath);
      }
    } catch (err: any) {
      console.error(`[ML] Failed to generate face thumbnails for ${mediaId}:`, err.message);
    }
  }

  static async generateClipEmbedding(mediaId: string, fullPath?: string) {
    try {
      await SmartSearchService.processAndSaveMediaEmbedding(mediaId, fullPath);
      console.log(`[ML] CLIP vector embedding generated and stored for media: ${mediaId}`);
    } catch (err: any) {
      console.error(`[ML] Failed to generate CLIP embedding for ${mediaId}:`, err.message);
    }
  }
}

