export function computeCoverObjectPosition(
  bb: { x1?: number; y1?: number; x2?: number; y2?: number; x?: number; y?: number; w?: number; h?: number } | null,
  imgWidth: number | null,
  imgHeight: number | null
): string {
  if (!bb) {
    console.log('[cover] no bb, fallback center 35%');
    return 'center 35%';
  }
  const x1 = bb.x1 ?? bb.x ?? 0;
  const y1 = bb.y1 ?? bb.y ?? 0;
  const x2 = bb.x2 ?? (x1 + (bb.w || 200));
  const y2 = bb.y2 ?? (y1 + (bb.h || 200));
  const faceX = ((x1 + x2) / 2);
  const faceY = ((y1 + y2) / 2);
  console.log('[cover] raw', { x1, y1, x2, y2, faceX, faceY, imgWidth, imgHeight });
  if (!imgWidth || !imgHeight) {
    console.log('[cover] missing dims, using center 35%');
    return 'center 35%';
  }
  const result = `${(faceX / imgWidth) * 100}% ${(faceY / imgHeight) * 100}%`;
  console.log('[cover] result', result);
  return result;
}
