// Premiere edit points, in seconds (254016000000 ticks / second in Lyra.prproj).
export const FILM_DURATION = 76.458333;
// Measured against the exported film: first black frame is 1589 / 24.
// The nested Premiere sequence's local time was 8 frames early.
export const FILM_OUTRO = 1589 / 24;
export function filmSourceTime(seconds: number): number {
  // Hold the last source frame until the exported ending's actual cut.
  const time = Math.max(0, Math.min(65.875, Number.isFinite(seconds) ? seconds : 0));
  return (time + (time < 56.083333 ? 10 / 24 : time < 58.666667 ? 1 : 4 / 3)) * 1000;
}
export function clampFilmTime(value: number): number {
  return Math.max(0, Math.min(FILM_DURATION, Number.isFinite(value) ? value : 0));
}
export function filmTimeLabel(value: number): string {
  const seconds = Math.floor(clampFilmTime(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
