export function computeCoverObjectPosition(
  bb: { x1?: number; y1?: number; x2?: number; y2?: number; x?: number; y?: number; w?: number; h?: number } | null,
  imgWidth: number | null,
  imgHeight: number | null
): string {
  if (!bb || !imgWidth || !imgHeight) return 'center 30%';
  const x1 = bb.x1 ?? bb.x ?? 0;
  const y1 = bb.y1 ?? bb.y ?? 0;
  const x2 = bb.x2 ?? (x1 + (bb.w || 200));
  const y2 = bb.y2 ?? (y1 + (bb.h || 200));
  return `${((x1 + x2) / 2 / imgWidth) * 100}% ${((y1 + y2) / 2 / imgHeight) * 100}%`;
}
