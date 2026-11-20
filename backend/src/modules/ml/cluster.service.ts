import { query } from '../../config/db';
import { redis } from '../../config/redis';
import { v4 as uuidv4 } from 'uuid';

export class ClusterService {
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

    // Step 1: Incremental mode (wipe queries removed)
    console.log('[Clustering] Running in incremental mode (existing assignments kept).');

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

    // Step 3: Populate the people table from all distinct person_ids with initial cover and face count
    await query(`
      INSERT INTO people (id, name, face_count, cover_face_id, cover_media_id, updated_at)
      SELECT 
        agg.person_id,
        '',
        agg.cnt,
        rep.id,
        rep.media_id,
        agg.latest
      FROM (
        SELECT person_id, COUNT(*)::int as cnt, MAX(created_at) as latest
        FROM face_embeddings
        WHERE person_id IS NOT NULL
        GROUP BY person_id
      ) agg
      CROSS JOIN LATERAL (
        SELECT id, media_id
        FROM face_embeddings
        WHERE person_id = agg.person_id
        ORDER BY created_at DESC
        LIMIT 1
      ) rep
      ON CONFLICT (id) DO UPDATE SET
        face_count = EXCLUDED.face_count,
        cover_face_id = COALESCE(people.cover_face_id, EXCLUDED.cover_face_id),
        cover_media_id = COALESCE(people.cover_media_id, EXCLUDED.cover_media_id),
        updated_at = EXCLUDED.updated_at
    `);

    // Invalidate face cache in Redis
    try {
      const keys = await redis.keys('faces:list:*');
      if (keys.length > 0) await redis.del(...keys);
    } catch {}

    console.log('[Clustering] Face clustering complete!');
  }
}
