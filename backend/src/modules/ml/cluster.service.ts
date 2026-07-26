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

  static async reclusterFaces(eps: number = 0.6, minSamples: number = 1) {
    console.log(`[Clustering] Fetching face embeddings for dynamic DBSCAN clustering (eps=${eps}, minSamples=${minSamples})...`);
    const result = await query(`SELECT id, person_id, embedding::text as vector FROM face_embeddings`);
    const rows = result.rows;

    if (rows.length === 0) {
      console.log('[Clustering] No faces to cluster.');
      return;
    }

    console.log(`[Clustering] Running dynamic DBSCAN on ${rows.length} faces...`);

    // Parse and normalize vectors to Float32Array for high performance
    const dataset: Float32Array[] = rows.map(r => {
      let arr: number[];
      if (typeof r.vector === 'string') {
        try {
          arr = JSON.parse(r.vector);
        } catch (e) {
          arr = new Array(512).fill(0);
        }
      } else if (Array.isArray(r.vector)) {
        arr = r.vector;
      } else {
        arr = new Array(512).fill(0);
      }

      const f32 = new Float32Array(512);
      let norm = 0;
      for (let i = 0; i < 512; i++) {
        const val = arr[i] || 0;
        f32[i] = val;
        norm += val * val;
      }
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let i = 0; i < 512; i++) {
          f32[i] /= norm;
        }
      }
      return f32;
    });

    const n = dataset.length;
    const minDot = 1.0 - eps;
    const adj: number[][] = new Array(n);
    for (let i = 0; i < n; i++) {
      adj[i] = [];
    }

    // Build pairwise symmetric graph with 8-way SIMD unrolled Float32Array dot products
    for (let i = 0; i < n; i++) {
      const targetVec = dataset[i];
      for (let j = i + 1; j < n; j++) {
        const vec = dataset[j];
        let dot = 0;
        for (let k = 0; k < 512; k += 8) {
          dot += targetVec[k] * vec[k]
               + targetVec[k+1] * vec[k+1]
               + targetVec[k+2] * vec[k+2]
               + targetVec[k+3] * vec[k+3]
               + targetVec[k+4] * vec[k+4]
               + targetVec[k+5] * vec[k+5]
               + targetVec[k+6] * vec[k+6]
               + targetVec[k+7] * vec[k+7];
        }
        if (dot >= minDot) {
          adj[i].push(j);
          adj[j].push(i);
        }
      }
    }

    // Dynamic DBSCAN Clustering execution
    const visited = new Uint8Array(n);
    const inCluster = new Uint8Array(n);
    const clusters: number[][] = [];
    const noise: number[] = [];

    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      visited[i] = 1;

      const neighbors = [i, ...adj[i]];
      if (neighbors.length < minSamples) {
        noise.push(i);
      } else {
        const cluster: number[] = [];
        for (const idx of neighbors) {
          inCluster[idx] = 1;
        }

        for (let k = 0; k < neighbors.length; k++) {
          const neighborIdx = neighbors[k];
          cluster.push(neighborIdx);

          if (!visited[neighborIdx]) {
            visited[neighborIdx] = 1;
            const subNeighbors = adj[neighborIdx];
            if (subNeighbors.length + 1 >= minSamples) {
              for (let m = 0; m < subNeighbors.length; m++) {
                const sn = subNeighbors[m];
                if (!inCluster[sn]) {
                  inCluster[sn] = 1;
                  neighbors.push(sn);
                }
              }
            }
          }
        }
        clusters.push(cluster);
      }
    }

    console.log(`[Clustering] DBSCAN found ${clusters.length} clusters. Noise points: ${noise.length}`);

    // Update database for each cluster using batched WHERE id = ANY($2::uuid[])
    for (const cluster of clusters) {
      let personId: string | null = null;
      for (const index of cluster) {
        if (rows[index].person_id) {
          personId = rows[index].person_id;
          break;
        }
      }
      if (!personId) personId = uuidv4();
      const faceIds = cluster.map(idx => rows[idx].id);
      await query(`UPDATE face_embeddings SET person_id = $1 WHERE id = ANY($2::uuid[])`, [personId, faceIds]);
    }

    if (noise.length > 0) {
      if (minSamples > 1) {
        const noiseFaceIds = noise.map(idx => rows[idx].id);
        await query(`UPDATE face_embeddings SET person_id = NULL WHERE id = ANY($1::uuid[])`, [noiseFaceIds]);
      } else {
        for (const index of noise) {
          const personId = rows[index].person_id || uuidv4();
          const faceId = rows[index].id;
          await query(`UPDATE face_embeddings SET person_id = $1 WHERE id = $2`, [personId, faceId]);
        }
      }
    }

    console.log('[Clustering] Dynamic DBSCAN face clustering complete!');
  }
}
