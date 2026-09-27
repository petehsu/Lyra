/** Anchor navigation has a fixed duration; wheel input uses the adaptive profile below. */
export const SITE_SCROLL_DURATION = 0.5;
export const siteScrollEase = (progress: number) => 1 - (1 - Math.max(0, Math.min(1, progress))) ** 3;

/** Rebase document coordinates without moving the scene on screen. A hidden
 * prefix makes the workspace the native top edge, not a JS scroll correction.
 */
export function rebaseWorkbenchScroll(scroll: number, hiddenPrefix: number, siteActive: boolean) {
  const prefix = siteActive ? 0 : hiddenPrefix || scroll;
  return { prefix, scroll: Math.max(0, scroll + hiddenPrefix - prefix) };
}

/** Estimate input speed in px/s over 120ms, independent of the display's FPS. */
export function createSiteWheelMotion() {
  let lastTime: number | null = null;
  let direction = 0;
  let speed = 0;
  return {
    reset() {
      lastTime = null;
      direction = speed = 0;
    },
    sample(delta: number, time: number) {
      const elapsed = lastTime === null ? Infinity : Math.max(0, time - lastTime);
      const nextDirection = Math.sign(delta);
      const reversing = elapsed <= 250 && direction !== 0 && nextDirection !== 0 && nextDirection !== direction;
      if (reversing || elapsed > 250) speed = 0;
      // Integrate distance over time rather than treating one wheel event as
      // one frame. Trackpads and notched wheels have very different cadences.
      speed = Math.min(12000, speed * Math.exp(-elapsed / 120) + Math.abs(delta) / 0.12);
      lastTime = time;
      if (nextDirection !== 0) direction = nextDirection;
      const strength = Math.min(1, speed / 4000);
      const blend = strength * strength * (3 - 2 * strength);
      const duration = reversing ? 0.18 : 0.18 + 0.42 * blend;
      const exponent = reversing ? 3.2 : 3.2 - 0.8 * blend;
      // Capture this sample's curve: later inputs must not mutate a running ease.
      const easing = (progress: number) => 1 - (1 - Math.max(0, Math.min(1, progress))) ** exponent;
      return { duration, easing, reversing };
    }
  };
}

/** Other workspace tabs block only the preceding story, never the sections below. */
export const clampSiteScrollTarget = (target: number, lowerBoundary: number | null) =>
  Math.max(lowerBoundary ?? 0, target);

/** Reversing discards the old destination instead of fighting its remaining tail. */
export function getSiteWheelDelta(current: number, target: number, delta: number, lowerBoundary: number | null) {
  const origin = (target - current) * delta < 0 ? current : target;
  return clampSiteScrollTarget(origin + delta, lowerBoundary) - target;
}
