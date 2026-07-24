import { query } from '../../config/db';
import clustering from 'density-clustering';
import { v4 as uuidv4 } from 'uuid';

export class ClusterService {
  static cosineDistance(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 1; // max distance
    return 1 - (dotProduct / (Math.sqrt(normA) * Math.sqrt(normB)));
  }

  static async reclusterFaces() {
    console.log('[Clustering] Fetching face embeddings...');
    const result = await query(`SELECT id, embedding::text as vector FROM face_embeddings`);
    const rows = result.rows;

    if (rows.length === 0) {
      console.log('[Clustering] No faces to cluster.');
      return;
    }

    // Parse vectors
    const dataset = rows.map(r => JSON.parse(r.vector));

    console.log(`[Clustering] Running DBSCAN on ${dataset.length} faces...`);
    const dbscan = new clustering.DBSCAN();
    
    // Immich buffalo_l cosine distance threshold is typically 0.6
    // minPts = 1 means it will group any faces within 0.6 distance.
    const clusters = dbscan.run(dataset, 0.6, 1, this.cosineDistance);
    const noise = dbscan.noise; // points that didn't form a cluster based on minPts (should be none since minPts=1)

    console.log(`[Clustering] Found ${clusters.length} clusters. Noise points: ${noise.length}`);

    // Update the database
    for (const cluster of clusters) {
      const personId = uuidv4();
      for (const index of cluster) {
        const faceId = rows[index].id;
        await query(`UPDATE face_embeddings SET person_id = $1 WHERE id = $2`, [personId, faceId]);
      }
    }

    // Assign noise points to unique persons just in case (should not happen with minPts=1)
    for (const index of noise) {
      const personId = uuidv4();
      const faceId = rows[index].id;
      await query(`UPDATE face_embeddings SET person_id = $1 WHERE id = $2`, [personId, faceId]);
    }

    console.log('[Clustering] Re-clustering complete!');
  }
}
