import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { query } from '../../config/db';
import { SmartSearchService } from './smartSearch.service';
import { CacheTrackerService } from '../media/cacheTracker.service';
import { getPersonCoverOrderClause, PERSON_COVER_ORDER_CLAUSE } from './personCover.utils';

const defaultCacheDir = fs.existsSync('/app/cache') ? '/app/cache' : path.resolve(process.cwd(), '../volumes/cache_rw');
const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || defaultCacheDir);
const ML_URL = process.env.IMMICH_ML_URL || 'http://localhost:3003';

// H-2 Fix: Read confidence threshold dynamically from admin_settings instead of hardcoding.
const DEFAULT_CONFIDENCE_THRESHOLD = 0.25; // cosine distance (lower = more similar)
async function getFaceMatchThreshold(): Promise<number> {
  try {
    const res = await query(`SELECT value FROM admin_settings WHERE key = 'ml_confidence'`);
    if (res.rows.length > 0) {
      const val = JSON.parse(res.rows[0].value);
      const num = parseFloat(String(val));
      // admin UI stores similarity score (0-1 where higher = stricter);
      // convert to cosine distance: distance = 1 - similarity
      if (!isNaN(num) && num > 0 && num < 1) return 1 - num;
    }
  } catch (e) {
    // non-critical, fall through to default
  }
  return DEFAULT_CONFIDENCE_THRESHOLD;
}

export const FACE_THUMB_SIZE = 400;
export const FACE_PADDING = 0.55;

export function parseBoundingBox(
  box: any,
  origW?: number | null,
  origH?: number | null
): { left: number; top: number; width: number; height: number } {
  let x1 = 0, y1 = 0, x2 = 100, y2 = 100;
  if (box && box.x1 !== undefined && box.y1 !== undefined && box.x2 !== undefined && box.y2 !== undefined) {
    x1 = Number(box.x1);
    y1 = Number(box.y1);
    x2 = Number(box.x2);
    y2 = Number(box.y2);
  } else if (box && box.x !== undefined && box.y !== undefined && box.w !== undefined && box.h !== undefined) {
    x1 = Number(box.x);
    y1 = Number(box.y);
    x2 = x1 + Number(box.w);
    y2 = y1 + Number(box.h);
  }

  const rawW = Math.max(1, x2 - x1);
  const rawH = Math.max(1, y2 - y1);
  // Human face center: shift slightly up (8% of face height) to include hair and avoid cutting off the top of the head
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2 - rawH * 0.08;

  // Make square crop with padding to include the full head comfortably
  const boxDim = Math.max(rawW, rawH);
  const cropSize = Math.ceil(boxDim * (1 + 2 * FACE_PADDING));

  let left = Math.floor(cx - cropSize / 2);
  let top = Math.floor(cy - cropSize / 2);

  const maxW = origW && origW > 0 ? origW : null;
  const maxH = origH && origH > 0 ? origH : null;

  if (maxW !== null && maxH !== null) {
    if (left < 0) left = 0;
    if (top < 0) top = 0;
    if (left + cropSize > maxW) left = Math.max(0, maxW - cropSize);
    if (top + cropSize > maxH) top = Math.max(0, maxH - cropSize);
    const finalW = Math.min(cropSize, maxW - left);
    const finalH = Math.min(cropSize, maxH - top);
    return { left, top, width: Math.max(1, finalW), height: Math.max(1, finalH) };
  }

  return {
    left: Math.max(0, left),
    top: Math.max(0, top),
    width: Math.max(1, cropSize),
    height: Math.max(1, cropSize),
  };
}

export class MLService {
  static async detectFaces(mediaId: string, fullPath?: string) {
    try {
      const cache480 = path.join(CACHE_ROOT, '480p', `${mediaId}.webp`);
      const cache1080 = path.join(CACHE_ROOT, '1080p', `${mediaId}.webp`);

      let imagePath = '';
      if (fs.existsSync(cache480)) {
        imagePath = cache480;
      } else if (fs.existsSync(cache1080)) {
        imagePath = cache1080;
      } else if (fullPath && fs.existsSync(fullPath)) {
        const ext = path.extname(fullPath).toLowerCase();
        const supportedNatively = ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.bmp', '.gif'];
        if (supportedNatively.includes(ext)) {
          imagePath = fullPath;
        }
      }

      if (!imagePath) {
        // Fallback to db lookup if nothing else is available
        const dbRes = await query(`SELECT folder_path, file_name FROM media_files WHERE id = $1`, [mediaId]);
        if (dbRes.rows.length > 0) {
          const mediaRoot = process.env.MEDIA_ROOT || '/app/media';
          const candidate = path.join(mediaRoot, dbRes.rows[0].folder_path, dbRes.rows[0].file_name);
          if (fs.existsSync(candidate)) {
            const ext = path.extname(candidate).toLowerCase();
            const supportedNatively = ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.bmp', '.gif'];
            if (supportedNatively.includes(ext)) {
              imagePath = candidate;
            }
          }
        }
      }

      if (!imagePath) {
        throw new Error(`Thumbnail not yet available for media ID: ${mediaId}`);
      }

      if (!imagePath || !fs.existsSync(imagePath)) {
        console.warn(`[ML] Image ${mediaId} not found on disk for face detection.`);
        return;
      }


      // Get image dimensions and store on media_files
      try {
        const meta = await sharp(imagePath).metadata();
        if (meta.width && meta.height) {
          await query(`UPDATE media_files SET img_width = $1, img_height = $2 WHERE id = $3`, [meta.width, meta.height, mediaId]);
        }
      } catch (e) {
        // non-critical
      }
      
      const entriesJson = JSON.stringify({
        "facial-recognition": {
          "recognition": { "modelName": "buffalo_l" },
          "detection": { "modelName": "buffalo_l", "options": { "minScore": 0.7 } }
        }
      });

      // Use FormData + ReadStream to avoid loading the full image into a Buffer.
      // This streams the file directly to the ML container without V8 heap allocation.
      const imageStream = fs.createReadStream(imagePath);
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        imageStream.on('data', (chunk: any) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        imageStream.on('end', resolve);
        imageStream.on('error', reject);
      });
      const imageBlob = new Blob(chunks as any, { type: 'image/webp' });
      const formData = new FormData();
      formData.append('entries', entriesJson);
      formData.append('image', imageBlob, 'image.webp');

      const response = await fetch(`${ML_URL}/predict`, {
        method: 'POST',
        body: formData as any
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
        
        // Query face_embeddings using pgvector cosine distance to match existing known identities.
        // H-2 Fix: threshold is now read from admin_settings instead of being hardcoded.
        const matchThreshold = await getFaceMatchThreshold();
        const matchResult = await query(`
          SELECT person_id 
          FROM face_embeddings 
          WHERE person_id IS NOT NULL AND embedding <=> $1::vector < $2 
          ORDER BY embedding <=> $1::vector 
          LIMIT 1
        `, [embeddingString, matchThreshold]);

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
      throw err;
    }
  }

  static async cropAndSaveFaceThumbnail(
    face: { media_id: string; bounding_box: any; img_width?: number | null; img_height?: number | null },
    fullPath: string,
    outPath: string
  ): Promise<boolean> {
    const cache1080 = path.join(CACHE_ROOT, '1080p', `${face.media_id}.webp`);
    const cache480 = path.join(CACHE_ROOT, '480p', `${face.media_id}.webp`);
    
    // Prioritize highest-resolution source: original fullPath if supported image, or 1080p cache, fallback to 480p
    let sourcePath = '';
    const ext = fullPath ? path.extname(fullPath).toLowerCase() : '';
    const isSupportedImage = ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.bmp'].includes(ext);

    if (fullPath && isSupportedImage && fs.existsSync(fullPath)) {
      sourcePath = fullPath;
    } else if (fs.existsSync(cache1080)) {
      sourcePath = cache1080;
    } else if (fullPath && fs.existsSync(fullPath)) {
      sourcePath = fullPath;
    } else if (fs.existsSync(cache480)) {
      sourcePath = cache480;
    }
    if (!sourcePath) return false;

    const meta = await sharp(sourcePath).metadata();
    const imgW = meta.width || 1;
    const imgH = meta.height || 1;

    const origW = face.img_width || imgW;
    const origH = face.img_height || imgH;
    const crop = parseBoundingBox(face.bounding_box, origW, origH);

    if (origW && origH && (origW !== imgW || origH !== imgH)) {
      const scaleX = imgW / origW;
      const scaleY = imgH / origH;
      crop.left = Math.round(crop.left * scaleX);
      crop.top = Math.round(crop.top * scaleY);
      crop.width = Math.round(crop.width * scaleX);
      crop.height = Math.round(crop.height * scaleY);
    }

    crop.left = Math.max(0, Math.min(crop.left, imgW - 1));
    crop.top = Math.max(0, Math.min(crop.top, imgH - 1));
    crop.width = Math.max(1, Math.min(crop.width, imgW - crop.left));
    crop.height = Math.max(1, Math.min(crop.height, imgH - crop.top));

    const info = await sharp(sourcePath)
      .extract(crop)
      .resize(FACE_THUMB_SIZE, FACE_THUMB_SIZE, { fit: 'cover' })
      .webp({ quality: 85 })
      .toFile(outPath);

    if (info?.size) {
      CacheTrackerService.recordWrite('faces', info.size).catch(() => {});
    }

    return true;
  }

  static async generateFaceThumbnails(mediaId: string) {
    try {
      const faces = await query(`
        SELECT fe.id, fe.person_id, fe.bounding_box, m.folder_path, m.file_name,
               COALESCE(m.img_width, (m.exif_json->>'width')::int) AS img_width,
               COALESCE(m.img_height, (m.exif_json->>'height')::int) AS img_height
        FROM face_embeddings fe
        JOIN media_files m ON m.id = fe.media_id
        WHERE fe.media_id = $1 AND fe.person_id IS NOT NULL
      `, [mediaId]);

      const mediaRoot = process.env.MEDIA_ROOT || '/app/media';
      const outDir = path.join(CACHE_ROOT, 'faces');
      await fs.promises.mkdir(outDir, { recursive: true });

      for (const face of faces.rows) {
        // Only generate if this media is the best for this person (explicit cover or best solo/HD face)
        const best = await query(`
          SELECT COALESCE(
            (SELECT cover_media_id FROM people WHERE id = $1 AND cover_media_id IS NOT NULL),
            (SELECT fe2.media_id FROM face_embeddings fe2
              JOIN media_files m2 ON m2.id = fe2.media_id
              WHERE fe2.person_id = $1
                AND m2.mime_type LIKE 'image/%'
              ORDER BY ${getPersonCoverOrderClause('fe2', 'm2')}
              LIMIT 1)
          ) AS media_id
        `, [face.person_id]);
        if (best.rows.length === 0 || best.rows[0].media_id !== mediaId) continue;

        const fullPath = path.join(mediaRoot, face.folder_path, face.file_name);
        const outPath = path.join(outDir, `${face.person_id}.webp`);

        await MLService.cropAndSaveFaceThumbnail(face, fullPath, outPath);
      }
    } catch (err: any) {
      console.error(`[ML] Failed to generate face thumbnails for ${mediaId}:`, err.message);
      throw err;
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

