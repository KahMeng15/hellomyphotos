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

  static async reclusterFaces(eps: number = 0.25, minSamples: number = 1): Promise<void> {
    console.log(`[Clustering] Starting batch pgvector face clustering (eps=${eps})...`);

    // Step 1: Wipe all existing (potentially bad) cluster assignments and people.
    // This ensures we start from a clean slate every time recluster is called.
    // If you want to preserve manual name assignments, change to a more targeted approach.
    await query(`UPDATE face_embeddings SET person_id = NULL WHERE person_id IS NOT NULL`);
    await query(`DELETE FROM people`);
    console.log('[Clustering] Cleared existing assignments.');

    // Step 2: Assign each face to an existing person if a close enough neighbour exists.
    // We do this iteratively in rounds until no more assignments are made.
    // Each round, unassigned faces that are within eps of an already-assigned face get merged.
    //
    // The key trick: we query the top-K neighbours WITHOUT a person_id filter (so HNSW
    // runs at full speed), and then apply the filter on the small result set.
    let round = 0;
    let assigned = 1; // set to 1 to enter the loop
    while (assigned > 0) {
      round++;
      const result = await query(`
        WITH nearest AS (
          SELECT
            u.id                           AS unassigned_id,
            (
              SELECT a.person_id
              FROM face_embeddings a
              WHERE a.person_id IS NOT NULL
                AND (a.embedding <=> u.embedding) < $1
              ORDER BY a.embedding <=> u.embedding
              LIMIT 1
            ) AS matched_person_id
          FROM face_embeddings u
          WHERE u.person_id IS NULL
        )
        UPDATE face_embeddings fe
        SET person_id = nearest.matched_person_id
        FROM nearest
        WHERE fe.id = nearest.unassigned_id
          AND nearest.matched_person_id IS NOT NULL
        RETURNING fe.id
      `, [eps]);
      assigned = result.rowCount ?? 0;
      console.log(`[Clustering] Round ${round}: assigned ${assigned} faces to existing people.`);
    }

    // Step 3: All remaining unassigned faces have no close neighbour yet.
    // Each one becomes the seed of a new person cluster.
    const newPeople = await query(`
      UPDATE face_embeddings
      SET person_id = gen_random_uuid()
      WHERE person_id IS NULL
      RETURNING person_id
    `);
    console.log(`[Clustering] Created ${newPeople.rowCount} new person seeds.`);

    // Step 4: Populate the people table from all distinct person_ids now in face_embeddings.
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
