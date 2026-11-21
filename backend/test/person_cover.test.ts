import assert from 'assert';
import { getPersonCoverOrderClause, PERSON_COVER_ORDER_CLAUSE } from '../src/modules/ml/personCover.utils';
import { computeCoverObjectPosition } from '../src/modules/media/cover.utils';
import { parseBoundingBox } from '../src/modules/ml/ml.service';

console.log('--- Testing personCover.utils ---');
assert(typeof PERSON_COVER_ORDER_CLAUSE === 'string');
assert(PERSON_COVER_ORDER_CLAUSE.includes("fe.bounding_box->>'x1'"));
assert(PERSON_COVER_ORDER_CLAUSE.includes("(SELECT COUNT(*) FROM face_embeddings"));

// Test custom aliases
const customClause = getPersonCoverOrderClause('fe2', 'm2');
assert(customClause.includes("fe2.bounding_box->>'x1'"));
assert(customClause.includes("m2.id"));
console.log('✓ personCover.utils tests passed');

console.log('--- Testing computeCoverObjectPosition ---');
// Test 1: Fallback for null input
assert.strictEqual(computeCoverObjectPosition(null, 1920, 1080), 'center center');
assert.strictEqual(computeCoverObjectPosition({ x1: 10, y1: 10 }, null, null), 'center center');

// Test 2: Standard landscape image (1920x1080) in container (1200x380)
// Face at y = 30% of photo (y1=200, y2=450 -> center=325/1080 = 0.30)
const pos1 = computeCoverObjectPosition({ x1: 800, y1: 200, x2: 1120, y2: 450 }, 1920, 1080);
console.log('Landscape photo position:', pos1);
const [pctX1, pctY1] = pos1.split(' ').map(p => parseFloat(p));
assert(pctX1 >= 0 && pctX1 <= 100);
assert(pctY1 >= 20 && pctY1 <= 40, `Expected pctY around 30%, got ${pctY1}`);

// Test 3: Face lower down in photo (y1=500, y2=750 -> center=625/1080 = 0.58)
// computeCoverObjectPosition should shift pctY up so face lands above gradient
const pos2 = computeCoverObjectPosition({ x1: 800, y1: 500, x2: 1120, y2: 750 }, 1920, 1080);
console.log('Lower face photo position:', pos2);
const [, pctY2] = pos2.split(' ').map(p => parseFloat(p));
assert(pctY2 > pctY1, 'Lower face in photo must increase pctY offset to shift image up');

// Test 4: Portrait orientation image (2000x3000)
const pos3 = computeCoverObjectPosition({ x1: 800, y1: 500, x2: 1200, y2: 900 }, 2000, 3000);
console.log('Portrait photo position:', pos3);
const [, pctY3] = pos3.split(' ').map(p => parseFloat(p));
assert(pctY3 >= 0 && pctY3 <= 100);

console.log('✓ computeCoverObjectPosition tests passed');

console.log('--- Testing parseBoundingBox ---');
// Test box with x1, y1, x2, y2
const box1 = parseBoundingBox({ x1: 100, y1: 100, x2: 200, y2: 200 }, 1000, 1000);
console.log('parseBoundingBox result:', box1);
assert(box1.width === box1.height, 'Crop box must be square for avatar thumbnails');
assert(box1.left >= 0 && box1.top >= 0);
assert(box1.width > 100, 'Crop box must include padding');

// Test near edge bounding box
const boxEdge = parseBoundingBox({ x1: 0, y1: 0, x2: 100, y2: 100 }, 500, 500);
assert(boxEdge.left === 0 && boxEdge.top === 0);
assert(boxEdge.left + boxEdge.width <= 500);
assert(boxEdge.top + boxEdge.height <= 500);

console.log('✓ parseBoundingBox tests passed');
console.log('ALL TESTS PASSED!');
process.exit(0);
