import fs from 'fs';
import path from 'path';
import { query } from '../../config/db';

const CACHE_ROOT = process.env.CACHE_ROOT || '/app/cache';
const ML_URL = process.env.IMMICH_ML_URL || 'http://machine-learning:3003';

export class MLService {
  static async detectFaces(mediaId: string) {
    try {
      const imagePath = path.join(CACHE_ROOT, '480p', `${mediaId}.webp`);
      if (!fs.existsSync(imagePath)) {
        console.warn(`[ML] Image ${mediaId} not found in cache for face detection.`);
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
      console.log('[ML] Data:', JSON.stringify(data));
      for (const face of data['facial-recognition'] || []) {
        const { boundingBox, embedding } = face;
        const embeddingString = typeof embedding === 'string' ? embedding : `[${embedding.join(',')}]`;
        
        // Find existing person cluster via Cosine Similarity distance (< 0.6 is a common threshold for buffalo_l)
        const matchResult = await query(`
          SELECT person_id 
          FROM face_embeddings 
          WHERE embedding <=> $1::vector < 0.6 
          ORDER BY embedding <=> $1::vector 
          LIMIT 1
        `, [embeddingString]);

        let personId = matchResult.rows.length > 0 ? matchResult.rows[0].person_id : null;
        
        // Generate new person UUID if no match found
        if (!personId) {
          const newPerson = await query(`SELECT gen_random_uuid() as id`);
          personId = newPerson.rows[0].id;
        }

        // Insert new face bounding box and embedding
        await query(`
          INSERT INTO face_embeddings (media_id, person_id, bounding_box, embedding)
          VALUES ($1, $2, $3, $4)
        `, [mediaId, personId, JSON.stringify(boundingBox), embeddingString]);
      }

    } catch (err: any) {
      console.error(`[ML] Failed to process faces for ${mediaId}:`, err.message);
    }
  }
}
