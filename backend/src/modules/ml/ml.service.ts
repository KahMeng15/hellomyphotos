import fs from 'fs';
import path from 'path';
import { query } from '../../config/db';
import { SmartSearchService } from './smartSearch.service';

const defaultCacheDir = fs.existsSync('/app/cache') ? '/app/cache' : path.resolve(process.cwd(), 'volumes/cache_rw');
const CACHE_ROOT = process.env.CACHE_ROOT || defaultCacheDir;
const ML_URL = process.env.IMMICH_ML_URL || 'http://localhost:3003';

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
        
        // Query face_embeddings using pgvector cosine distance (< 0.6) to match existing known identities
        const matchResult = await query(`
          SELECT person_id 
          FROM face_embeddings 
          WHERE person_id IS NOT NULL AND embedding <=> $1::vector < 0.6 
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

  static async generateClipEmbedding(mediaId: string, fullPath?: string) {
    try {
      await SmartSearchService.processAndSaveMediaEmbedding(mediaId, fullPath);
      console.log(`[ML] CLIP vector embedding generated and stored for media: ${mediaId}`);
    } catch (err: any) {
      console.error(`[ML] Failed to generate CLIP embedding for ${mediaId}:`, err.message);
    }
  }
}

