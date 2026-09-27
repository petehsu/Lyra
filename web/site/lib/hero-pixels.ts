export const HERO_PIXEL_SIZE = 6;

// Stable, coordinate-based noise: scrolling and resizing never shuffle pixels.
export function heroPixelNoise(column: number, row: number) {
  let value = Math.imul(column + 1, 374761393) ^ Math.imul(row + 1, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function heroPixelCovered(column: number, row: number, rows: number) {
  if (row === 0) return false;
  if (row >= rows - 2) return true;
  const progress = Math.max(0, Math.min(1, row / Math.max(1, rows - 3)));
  const density = progress * progress * (3 - 2 * progress);
  return heroPixelNoise(column, row) < density;
}

export function heroPixelResponse(distance: number, progress: number, strength: number) {
  // Seal the bottom edge even under the pointer, so the section never tears.
  const edge = Math.max(0, Math.min(1, (0.94 - progress) / 0.2));
  const proximity = Math.max(0, 1 - distance / 76);
  return 1 - 0.82 * proximity * proximity * edge * Math.max(0, Math.min(1, strength));
}
