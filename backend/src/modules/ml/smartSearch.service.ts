import {
  AutoProcessor,
  AutoTokenizer,
  CLIPVisionModelWithProjection,
  CLIPTextModelWithProjection,
  RawImage
} from '@xenova/transformers';
import fs from 'fs';
import path from 'path';
import { query, pool, ensureSchema } from '../../config/db';
import { redis } from '../../config/redis';
import { VideoService } from '../media/video.service';

const MODEL_NAME = 'Xenova/clip-vit-base-patch32';
const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || path.resolve(process.cwd(), '../volumes/cache_rw'));

let processorPromise: Promise<any> | null = null;
let visionModelPromise: Promise<any> | null = null;
let tokenizerPromise: Promise<any> | null = null;
let textModelPromise: Promise<any> | null = null;

async function getProcessor() {
  if (!processorPromise) {
    processorPromise = AutoProcessor.from_pretrained(MODEL_NAME);
  }
  return processorPromise;
}

async function getVisionModel() {
  if (!visionModelPromise) {
    visionModelPromise = CLIPVisionModelWithProjection.from_pretrained(MODEL_NAME);
  }
  return visionModelPromise;
}

async function getTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = AutoTokenizer.from_pretrained(MODEL_NAME);
  }
  return tokenizerPromise;
}

async function getTextModel() {
  if (!textModelPromise) {
    textModelPromise = CLIPTextModelWithProjection.from_pretrained(MODEL_NAME);
  }
  return textModelPromise;
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (norm === 0) return vector;
  return vector.map((val) => val / norm);
}

export class SmartSearchService {
  /**
   * Pre-warms the CLIP text model and tokenizer during server startup so the first
   * smart search query does not incur a multi-second cold-start delay.
   */
  static async preloadModel(): Promise<void> {
    try {
      await Promise.all([getTokenizer(), getTextModel()]);
      console.log('[SmartSearchService] CLIP text model pre-warmed and ready.');
    } catch (err: any) {
      console.warn('[SmartSearchService] Failed to pre-warm CLIP model:', err.message);
    }
  }

  /**
   * Generates a 512-dimensional CLIP text embedding for a query string.
   * Query embeddings are cached in Redis for 7 days to eliminate repeated CPU inference.
   */
  static async generateTextEmbedding(text: string): Promise<number[]> {
    const trimmed = text.trim().toLowerCase();
    const cacheKey = `clip:text:${trimmed}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err: any) {
      console.warn('[SmartSearchService] Redis get error for text embedding:', err.message);
    }

    const tokenizer = await getTokenizer();
    const textModel = await getTextModel();
    const textInputs = await tokenizer(text, { padding: true, truncation: true });
    const { text_embeds } = await textModel(textInputs);
    const rawArray = Array.from(text_embeds.data as Float32Array);
    const normalized = normalize(rawArray);

    try {
      // Cache query embedding for 7 days (604800 seconds)
      await redis.set(cacheKey, JSON.stringify(normalized), 'EX', 604800);
    } catch (err: any) {
      console.warn('[SmartSearchService] Redis set error for text embedding:', err.message);
    }

    return normalized;
  }

  /**
   * Generates a 512-dimensional CLIP image embedding for an image file path or Buffer.
   */
  static async generateImageEmbedding(imageInput: string | Buffer): Promise<number[]> {
    const processor = await getProcessor();
    const visionModel = await getVisionModel();
    let rawImage: any;
    if (typeof imageInput === 'string') {
      rawImage = await RawImage.read(imageInput);
    } else {
      rawImage = await RawImage.fromBlob(new Blob([new Uint8Array(imageInput)]));
    }
    const imageInputs = await processor(rawImage);
    const { image_embeds } = await visionModel(imageInputs);
    const rawArray = Array.from(image_embeds.data as Float32Array);
    return normalize(rawArray);
  }

  /**
   * Saves a 512-dimensional CLIP vector embedding into media_files.clip_embedding in PostgreSQL.
   */
  static async saveClipEmbedding(mediaId: string, embedding: number[]): Promise<void> {
    const vectorString = `[${embedding.join(',')}]`;
    
    // Update main media_files table vector column
    await query(`
      UPDATE media_files
      SET clip_embedding = $1::vector, updated_at = NOW()
      WHERE id = $2
    `, [vectorString, mediaId]);

    // Also sync smart_search_embeddings table if present
    try {
      await query(`
        INSERT INTO smart_search_embeddings (media_id, embedding)
        VALUES ($1, $2::vector)
        ON CONFLICT (media_id) DO UPDATE SET embedding = EXCLUDED.embedding, created_at = NOW()
      `, [mediaId, vectorString]);
    } catch (err: any) {
      console.warn('[SmartSearchService] Notice updating smart_search_embeddings table:', err.message);
    }
  }

  /**
   * Computes CLIP embedding for media file (from cache or source) and updates media_files.clip_embedding in DB.
   */
  static async processAndSaveMediaEmbedding(mediaId: string, fullPath?: string): Promise<number[]> {
    const cachedThumbnail = path.join(CACHE_ROOT, '480p', `${mediaId}.webp`);
    const cachedPreview = path.join(CACHE_ROOT, '1080p', `${mediaId}.webp`);

    let targetFile: string | null = null;
    if (fs.existsSync(cachedThumbnail)) {
      targetFile = cachedThumbnail;
    } else if (fs.existsSync(cachedPreview)) {
      targetFile = cachedPreview;
    } else if (fullPath && fs.existsSync(fullPath)) {
      const ext = path.extname(fullPath).toLowerCase();
      const supportedNatively = ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.bmp', '.gif'];
      if (supportedNatively.includes(ext)) {
        targetFile = fullPath;
      } else {
        const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.3gp', '.wmv', '.mts', '.m2ts', '.flv'];
        if (videoExts.includes(ext)) {
          try {
            await VideoService.extractThumbnail(mediaId, fullPath);
            if (fs.existsSync(cachedThumbnail)) {
              targetFile = cachedThumbnail;
            }
          } catch (e: any) {
            console.warn(`[SmartSearchService] On-demand video thumbnail extraction failed for ${mediaId}:`, e.message);
          }
        }
      }
    }

    if (!targetFile) {
      throw new Error(`Thumbnail not yet available for media ID: ${mediaId}`);
    }

    const embedding = await this.generateImageEmbedding(targetFile);
    await this.saveClipEmbedding(mediaId, embedding);
    return embedding;
  }

  /**
   * Performs vector similarity search over media_files ordered by clip_embedding vector cosine distance (<=>).
   * Supports limit and offset pagination. Uses a CTE subquery so Postgres can perform top-K vector
   * retrieval before joining folder_settings.
   *
   * Note: In pgvector HNSW index search, results are capped at hnsw.ef_search candidates (default 40).
   * We dynamically set LOCAL hnsw.ef_search based on (limit + offset) within the transaction
   * so pagination beyond 40 results returns all matching items.
   */
  static async searchMedia(queryText: string, limit: number = 50, offset: number = 0): Promise<any[]> {
    const textEmbedding = await this.generateTextEmbedding(queryText);
    const vectorString = `[${textEmbedding.join(',')}]`;

    await ensureSchema();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const efSearch = Math.min(2000, Math.max(100, limit + offset + 40));
      await client.query(`SET LOCAL hnsw.ef_search = ${efSearch}`);

      const result = await client.query(`
        WITH top_matches AS (
          SELECT m.id, m.folder_path, m.file_name, m.mime_type, m.blurhash, m.created_at,
                 (m.clip_embedding <=> $1::vector) AS distance
          FROM media_files m
          WHERE m.clip_embedding IS NOT NULL
          ORDER BY m.clip_embedding <=> $1::vector ASC
          LIMIT $2 OFFSET $3
        )
        SELECT t.*,
               COALESCE(fs.cover_media_id, fs.auto_cover_media_id) AS folder_cover_id
        FROM top_matches t
        LEFT JOIN folder_settings fs ON fs.folder_path = t.folder_path
        ORDER BY t.distance ASC
      `, [vectorString, limit, offset]);

      await client.query('COMMIT');
      return result.rows;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Performs vector similarity search for an existing embedding vector string.
   */
  static async findSimilarMedia(vectorString: string, limit: number = 50): Promise<any[]> {
    await ensureSchema();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const efSearch = Math.min(2000, Math.max(100, limit + 40));
      await client.query(`SET LOCAL hnsw.ef_search = ${efSearch}`);

      const result = await client.query(`
        SELECT m.id as media_id, m.id, m.file_name, m.folder_path, (m.clip_embedding <=> $1::vector) as distance
        FROM media_files m
        WHERE m.clip_embedding IS NOT NULL
        ORDER BY m.clip_embedding <=> $1::vector ASC
        LIMIT $2
      `, [vectorString, limit]);

      await client.query('COMMIT');
      return result.rows;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
