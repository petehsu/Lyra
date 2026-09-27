type RevealRange = {
  readonly totalDistance: number;
  readonly storyDistance: number;
  readonly revealStart: number;
  readonly revealDistance: number;
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** The scene and film share one flow box, including the native-scroll handoff. */
export function getWorkbenchFlowLayout(viewportHeight: number, flowHeight: number, revealEnd: number) {
  const handoffDistance = Math.min(viewportHeight * 0.32, revealEnd);
  // Finish showing the full, operable desktop before beginning to leave it.
  const release = revealEnd + handoffDistance;
  const stickyHeight = flowHeight - handoffDistance / 2;
  return { release, handoffDistance, stickyHeight, sceneHeight: release + stickyHeight };
}

/** Exit velocity ramps from 0 to native scrolling (-1 px per scroll px).
 * After release CSS sticky supplies the remaining displacement, not another tween.
 */
export function getWorkbenchFlowOffset(travel: number, release: number, handoffDistance: number) {
  if (handoffDistance <= 0) return 0;
  const phase = clamp((travel - release + handoffDistance) / handoffDistance);
  return phase === 0 ? 0 : -handoffDistance * phase * phase / 2;
}

export function getWorkbenchFrameSize(viewportWidth: number, viewportHeight: number) {
  const width = Math.min(1280, viewportWidth - 64);
  return { width, height: Math.min(width / 1.44, viewportHeight - 112) };
}

export type WorkbenchCamera = {
  readonly width: number;
  readonly height: number;
  readonly contentLeft: number;
  readonly contentTop: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
};

/** Keep the live application's layout fixed; only the outside camera zooms. */
export function getWorkbenchCameraFrame(camera: WorkbenchCamera, progress: number, storyTravel: number) {
  const p = clamp(progress);
  const initialScale = Math.max(
    (camera.viewportWidth + 2) / Math.max(1, camera.contentWidth),
    (camera.viewportHeight + 2) / Math.max(1, camera.contentHeight)
  );
  const scale = initialScale + (1 - initialScale) * p;
  const initialLeft = -camera.contentLeft * initialScale - 1;
  const initialTop = -camera.contentTop * initialScale - 1;
  const x = initialLeft + ((camera.viewportWidth - camera.width) / 2 - initialLeft) * p;
  const y = initialTop + ((camera.viewportHeight - camera.height) / 2 - 10 - initialTop) * p;
  return {
    x, y, scale,
    storyWidth: Math.min(camera.contentWidth * scale, camera.viewportWidth + 2),
    // Counter-scale only the website: its type remains readable as its viewport
    // narrows. The desktop renderer never receives per-frame resize events.
    storyScale: 1 / scale,
    storyY: (-storyTravel - y - camera.contentTop * scale - 1) / scale
  };
}

/** One reversible scroll position, with no delayed catch-up after scrolling. */
export function getWorkbenchRevealState(progress: number, range: RevealRange) {
  const travel = clamp(progress) * range.totalDistance;
  const cameraDistance = range.revealDistance;
  const cameraPhase = clamp((travel - range.revealStart) / Math.max(1, cameraDistance));
  return {
    // Zero velocity at both ends avoids snapping into/out of the camera move.
    cameraProgress: cameraPhase * cameraPhase * (3 - 2 * cameraPhase),
    cameraMoving: cameraPhase > 0 && cameraPhase < 1,
    storyTravel: Math.min(travel, range.storyDistance),
    // Fade the hint during the zoom, not in a stationary scroll segment after it.
    // Camera completion now meets the sticky section's release boundary.
    captionProgress: clamp((cameraPhase - 0.82) / 0.18)
  };
}
