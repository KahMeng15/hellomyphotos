export function computeCoverObjectPosition(
  bb: { x1?: number; y1?: number; x2?: number; y2?: number; x?: number; y?: number; w?: number; h?: number } | null,
  imgWidth: number | null,
  imgHeight: number | null
): string {
  const hero = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.header-wrapper') : null;
  const containerW = hero?.offsetWidth || 0;
  const containerH = hero?.offsetHeight || 0;

  if (!bb) {
    return 'center center';
  }

  const x1 = bb.x1 ?? bb.x ?? 0;
  const y1 = bb.y1 ?? bb.y ?? 0;
  const x2 = bb.x2 ?? (x1 + (bb.w || 200));
  const y2 = bb.y2 ?? (y1 + (bb.h || 200));
  const faceCenterX = (x1 + x2) / 2;
  const faceCenterY = (y1 + y2) / 2;
  const faceW = x2 - x1;
  const faceH = y2 - y1;

  if (!imgWidth || !imgHeight) {
    return 'center center';
  }

  const pctX = (faceCenterX / imgWidth) * 100;
  const pctY = Math.min((faceCenterY / imgHeight) * 100 + 10, 55);

  return `${pctX}% ${pctY}%`;
}
