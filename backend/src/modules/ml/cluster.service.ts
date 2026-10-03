import { query } from '../../config/db';
import { redis } from '../../config/redis';
import { v4 as uuidv4 } from 'uuid';

export class ClusterService {
  static cosineDistance(a: number[] | Float32Array, b: number[] | Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 1;
    const sim = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    return Math.max(0, 1 - sim);
  }

  static async reclusterFaces(overrideEps?: number, minSamples: number = 1): Promise<void> {
    let eps = overrideEps;
    if (eps === undefined) {
      const settingRes = await query(`SELECT value FROM admin_settings WHERE key = 'ml_cluster_strictness'`);
      if (settingRes.rows.length > 0) {
        eps = parseFloat(settingRes.rows[0].value) || 0.35;
      } else {
        eps = 0.35;
      }
    }

    console.log(`[Clustering] Starting safe batched pgvector clustering (eps=${eps})...`);

    // Step 1: Wipe existing assignments ONLY if they have one. 
    // (The WHERE clause prevents Postgres from rewriting 424K rows unnecessarily)
    await query(`UPDATE face_embeddings SET person_id = NULL WHERE person_id IS NOT NULL`);
    await query(`TRUNCATE TABLE people CASCADE`);
    console.log('[Clustering] Cleared existing assignments.');

    const totalRes = await query(`SELECT COUNT(*) as total FROM face_embeddings`);
    const total = parseInt(totalRes.rows[0].total, 10);

    const BATCH_SIZE = 1000;
    let processed = 0;
    const start = Date.now();

    while (true) {
      // 1. Fetch a batch of unassigned faces
      const batchRes = await query(`
        SELECT id, embedding::text as vector 
        FROM face_embeddings 
        WHERE person_id IS NULL 
        LIMIT $1
      `, [BATCH_SIZE]);
      
      if (batchRes.rows.length === 0) break;
      
      // 2. Process each face in the batch
      for (const row of batchRes.rows) {
        const embeddingString = typeof row.vector === 'string' ? 
          (row.vector.startsWith('[') ? row.vector : `[${row.vector}]`) : 
          `[${row.vector.join(',')}]`;
        
        // Query top 50 nearest neighbors USING the HNSW index (no IS NOT NULL filter!)
        const nnRes = await query(`
          SELECT person_id, (embedding <=> $1::vector) as distance
          FROM face_embeddings
          ORDER BY embedding <=> $1::vector
          LIMIT 50
        `, [embeddingString]);
        
        let personId = null;
        // Filter the results in Node to find the closest assigned person
        for (const nn of nnRes.rows) {
           if (nn.person_id !== null && nn.distance < eps) {
              personId = nn.person_id;
              break;
           }
        }
        
        // If no close assigned neighbor, become a new seed
        if (!personId) {
           personId = uuidv4();
        }
        
        // Update the face individually (very fast, no table locks)
        await query(`UPDATE face_embeddings SET person_id = $1 WHERE id = $2`, [personId, row.id]);
        processed++;
      }
      
      const elapsed = (Date.now() - start) / 1000;
      const rate = processed / elapsed;
      const remaining = total - processed;
      const etaSeconds = rate > 0 ? Math.round(remaining / rate) : 0;

      await redis.set("clustering:status", JSON.stringify({
        active: true,
        processed,
        total,
        etaSeconds,
        rate
      }), "EX", 60);

      console.log(`[Clustering] Processed ${processed}/${total} faces...`);
    }

    // Step 3: Populate the people table from all distinct person_ids
    await query(`
      INSERT INTO people (id, name)
      SELECT DISTINCT person_id, ''
      FROM face_embeddings
      WHERE person_id IS NOT NULL
      ON CONFLICT (id) DO NOTHING
    `);

    console.log('[Clustering] Face clustering complete!');
  }
}
