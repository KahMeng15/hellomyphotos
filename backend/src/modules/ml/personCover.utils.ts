/**
 * Person Cover Selection and Positioning Utilities
 *
 * Provides a standardized SQL ranking order for selecting the best cover image
 * and representative face for a person:
 *  1. Full face not cut off: face bounding box does not touch or exceed photo borders (margins >= 5px).
 *  2. HD face: face bounding box has at least 100x100 resolution.
 *  3. Solo images or fewer people: photo with 1 face (solo) first, then 2, 3, etc.
 *  4. HD media: media resolution is at least 1280x720.
 *  5. Face size / resolution: larger face pixel area.
 *  6. Overall media resolution: higher megapixel photo.
 *  7. Recency: newest photos break ties.
 */

export function getPersonCoverOrderClause(faceAlias = 'fe', mediaAlias = 'm'): string {
  return `
    -- 1. Full face: not cut off at edge of photo (margins of at least 5px from border)
    CASE 
      WHEN COALESCE((${faceAlias}.bounding_box->>'x1')::numeric, (${faceAlias}.bounding_box->>'x')::numeric, 0) <= 5
        OR COALESCE((${faceAlias}.bounding_box->>'y1')::numeric, (${faceAlias}.bounding_box->>'y')::numeric, 0) <= 5
        OR (COALESCE(${mediaAlias}.img_width, (${mediaAlias}.exif_json->>'width')::int, 0) > 0 
            AND COALESCE((${faceAlias}.bounding_box->>'x2')::numeric, (${faceAlias}.bounding_box->>'x')::numeric + (${faceAlias}.bounding_box->>'w')::numeric, 0) >= COALESCE(${mediaAlias}.img_width, (${mediaAlias}.exif_json->>'width')::int, 0) - 5)
        OR (COALESCE(${mediaAlias}.img_height, (${mediaAlias}.exif_json->>'height')::int, 0) > 0 
            AND COALESCE((${faceAlias}.bounding_box->>'y2')::numeric, (${faceAlias}.bounding_box->>'y')::numeric + (${faceAlias}.bounding_box->>'h')::numeric, 0) >= COALESCE(${mediaAlias}.img_height, (${mediaAlias}.exif_json->>'height')::int, 0) - 5)
      THEN 1 ELSE 0 
    END ASC,
    -- 2. Face is HD: face bounding box has at least 100x100 resolution
    CASE 
      WHEN (COALESCE((${faceAlias}.bounding_box->>'x2')::numeric, (${faceAlias}.bounding_box->>'x')::numeric + (${faceAlias}.bounding_box->>'w')::numeric, 0) - COALESCE((${faceAlias}.bounding_box->>'x1')::numeric, (${faceAlias}.bounding_box->>'x')::numeric, 0)) >= 100
       AND (COALESCE((${faceAlias}.bounding_box->>'y2')::numeric, (${faceAlias}.bounding_box->>'y')::numeric + (${faceAlias}.bounding_box->>'h')::numeric, 0) - COALESCE((${faceAlias}.bounding_box->>'y1')::numeric, (${faceAlias}.bounding_box->>'y')::numeric, 0)) >= 100
      THEN 0 ELSE 1 
    END ASC,
    -- 3. Solo images or lesser people (1 face first, then 2, 3...)
    (SELECT COUNT(*) FROM face_embeddings fe_cnt WHERE fe_cnt.media_id = ${mediaAlias}.id) ASC,
    -- 4. Media is HD (at least 1280x720)
    CASE 
      WHEN COALESCE(${mediaAlias}.img_width, (${mediaAlias}.exif_json->>'width')::int, 0) >= 1280 
        OR COALESCE(${mediaAlias}.img_height, (${mediaAlias}.exif_json->>'height')::int, 0) >= 720 
      THEN 0 ELSE 1 
    END ASC,
    -- 5. Face size / resolution (larger face is clearer)
    ((COALESCE((${faceAlias}.bounding_box->>'x2')::numeric, (${faceAlias}.bounding_box->>'x')::numeric + (${faceAlias}.bounding_box->>'w')::numeric, 0) - COALESCE((${faceAlias}.bounding_box->>'x1')::numeric, (${faceAlias}.bounding_box->>'x')::numeric, 0)) * 
     (COALESCE((${faceAlias}.bounding_box->>'y2')::numeric, (${faceAlias}.bounding_box->>'y')::numeric + (${faceAlias}.bounding_box->>'h')::numeric, 0) - COALESCE((${faceAlias}.bounding_box->>'y1')::numeric, (${faceAlias}.bounding_box->>'y')::numeric, 0))) DESC,
    -- 6. Media resolution (higher resolution photo)
    (COALESCE(${mediaAlias}.img_width, (${mediaAlias}.exif_json->>'width')::int, 0) * COALESCE(${mediaAlias}.img_height, (${mediaAlias}.exif_json->>'height')::int, 0)) DESC,
    -- 7. Recency
    ${mediaAlias}.created_at DESC
  `;
}

export const PERSON_COVER_ORDER_CLAUSE = getPersonCoverOrderClause('fe', 'm');
