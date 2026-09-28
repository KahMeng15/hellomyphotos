import { query } from '../../config/db';
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

  static async reclusterFaces(eps: number = 0.25, minSamples: number = 1) {
    console.log(`[Clustering] Running pgvector nearest-neighbour face clustering (eps=${eps}, minSamples=${minSamples})...`);

    // Fetch unassigned faces (person_id IS NULL)
    const unassigned = await query(`SELECT id, embedding::text as vector FROM face_embeddings WHERE person_id IS NULL`);
    const rows = unassigned.rows;

    if (rows.length > 0) {
      console.log(`[Clustering] Processing ${rows.length} unassigned faces...`);

      for (const row of rows) {
        if (!row.vector) continue;
        const embeddingString = typeof row.vector === 'string' ? row.vector : `[${row.vector.join(',')}]`;

        // Query pgvector for nearest face with assigned person_id
        const matchResult = await query(`
          SELECT person_id, (embedding <=> $1::vector) as distance
          FROM face_embeddings
          WHERE person_id IS NOT NULL
          ORDER BY embedding <=> $1::vector
          LIMIT 1
        `, [embeddingString]);

        let personId: string | null = null;
        if (matchResult.rows.length > 0 && matchResult.rows[0].distance < eps) {
          personId = matchResult.rows[0].person_id;
        } else {
          if (minSamples > 1) {
            const countResult = await query(`
              SELECT COUNT(*)::int as count
              FROM face_embeddings
              WHERE embedding <=> $1::vector < $2
            `, [embeddingString, eps]);
            if (countResult.rows[0].count >= minSamples) {
              personId = uuidv4();
            }
          } else {
            personId = uuidv4();
          }
        }

        if (personId) {
          await query(`UPDATE face_embeddings SET person_id = $1 WHERE id = $2`, [personId, row.id]);
        }
      }
    }

    // Bug #2 Fix: Populate people table for all novel/existing person_ids
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
