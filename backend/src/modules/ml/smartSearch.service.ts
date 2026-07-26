import {
  AutoProcessor,
  AutoTokenizer,
  CLIPVisionModelWithProjection,
  CLIPTextModelWithProjection,
  RawImage
} from '@xenova/transformers';
import fs from 'fs';
import path from 'path';
import { query } from '../../config/db';

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
   * Generates a 512-dimensional CLIP text embedding for a query string.
   */
  static async generateTextEmbedding(text: string): Promise<number[]> {
    const tokenizer = await getTokenizer();
    const textModel = await getTextModel();
    const textInputs = await tokenizer(text, { padding: true, truncation: true });
    const { text_embeds } = await textModel(textInputs);
    const rawArray = Array.from(text_embeds.data as Float32Array);
    return normalize(rawArray);
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
      targetFile = fullPath;
    }

    if (!targetFile) {
      throw new Error(`No accessible image file found for media ID: ${mediaId}`);
    }

    const embedding = await this.generateImageEmbedding(targetFile);
    await this.saveClipEmbedding(mediaId, embedding);
    return embedding;
  }

  /**
   * Performs vector similarity search over media_files ordered by clip_embedding vector cosine distance (<=>).
   */
  static async searchMedia(queryText: string, limit: number = 20): Promise<any[]> {
    const textEmbedding = await this.generateTextEmbedding(queryText);
    const vectorString = `[${textEmbedding.join(',')}]`;

    const result = await query(`
      SELECT m.id, m.folder_path, m.file_name, m.mime_type, m.blurhash, m.created_at,
             (m.clip_embedding <=> $1::vector) as distance
      FROM media_files m
      WHERE m.clip_embedding IS NOT NULL
      ORDER BY m.clip_embedding <=> $1::vector ASC
      LIMIT $2
    `, [vectorString, limit]);

    return result.rows;
  }
}
