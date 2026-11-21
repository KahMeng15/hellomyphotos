export function computeCoverObjectPosition(
  bb: { x1?: number; y1?: number; x2?: number; y2?: number; x?: number; y?: number; w?: number; h?: number } | null,
  imgWidth: number | null,
  imgHeight: number | null
): string {
  if (!bb || !imgWidth || !imgHeight) {
    return 'center center';
  }

  const x1 = bb.x1 ?? bb.x ?? 0;
  const y1 = bb.y1 ?? bb.y ?? 0;
  const x2 = bb.x2 ?? (x1 + (bb.w || 200));
  const y2 = bb.y2 ?? (y1 + (bb.h || 200));
  const faceCenterX = (x1 + x2) / 2;
  const faceCenterY = (y1 + y2) / 2;
  const faceH = Math.max(1, y2 - y1);

  const hero = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.header-wrapper') : null;
  const containerW = hero?.offsetWidth || (typeof window !== 'undefined' ? window.innerWidth : 1200);
  const containerH = hero?.offsetHeight || (typeof window !== 'undefined' ? Math.max(300, window.innerHeight * 0.4) : 380);

  // Scale applied by CSS object-fit: cover
  const scale = Math.max(containerW / imgWidth, containerH / imgHeight);
  const displayedW = imgWidth * scale;
  const displayedH = imgHeight * scale;

  // We want the face center to be positioned at ~28%-32% from the top of the container,
  // keeping the full face safely in the upper clear region and avoiding the dark gradient / title text below.
  let targetYRel = 0.30;
  const faceDispH = faceH * scale;
  if (faceDispH > containerH * 0.45) {
    targetYRel = 0.35;
  }

  let pctX = 50;
  if (displayedW > containerW) {
    const targetX = 0.50 * containerW;
    const faceDispX = (faceCenterX / imgWidth) * displayedW;
    pctX = ((faceDispX - targetX) / (displayedW - containerW)) * 100;
  } else {
    pctX = (faceCenterX / imgWidth) * 100;
  }

  let pctY = 30;
  if (displayedH > containerH) {
    const targetY = targetYRel * containerH;
    const faceDispY = (faceCenterY / imgHeight) * displayedH;
    pctY = ((faceDispY - targetY) / (displayedH - containerH)) * 100;
  } else {
    pctY = (faceCenterY / imgHeight) * 100;
  }

  const clampedX = Math.max(0, Math.min(100, Math.round(pctX * 10) / 10));
  const clampedY = Math.max(0, Math.min(100, Math.round(pctY * 10) / 10));

  return `${clampedX}% ${clampedY}%`;
}
