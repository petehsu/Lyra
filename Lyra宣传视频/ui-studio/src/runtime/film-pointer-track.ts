export type PointerPoint = { x: number; y: number };
export type FilmPointerTargets = {
  input: PointerPoint;
  send: PointerPoint;
  divider: PointerPoint;
  settings: PointerPoint;
  language: PointerPoint;
  option: PointerPoint;
};

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
const travel = (from: PointerPoint, to: PointerPoint, time: number, start: number, end: number) => {
  const t = smooth((time - start) / (end - start));
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
};

// Presentation seconds, NOT the source shot's clock: Premiere cuts skip source
// time around Settings. A continuous pointer must not inherit those jumps.
export function filmPointerAt(time: number, targets: FilmPointerTargets, width: number, height: number) {
  const outside = { x: width + 40, y: height * .46 };
  const rest = { x: width * .66, y: height * .46 };
  const park = { x: width * .88, y: height * .84 };
  const exit = { x: width + 40, y: targets.option.y };
  let point: PointerPoint;
  if (time < 8.05) point = travel(outside, rest, time, 5.2, 7.8);
  else if (time < 13.833333) point = travel(rest, targets.input, time, 8.05, 9.063333);
  else if (time < 14.5) point = travel(targets.input, targets.send, time, 13.833333, 14.216667);
  else if (time < 21.23) point = travel(targets.send, park, time, 14.5, 15);
  else if (time < 23.45) point = travel(park, targets.divider, time, 21.23, 21.75);
  else if (time < 55.2) point = travel(targets.divider, park, time, 23.45, 24.1);
  else if (time < 56.24) point = travel(park, targets.settings, time, 55.2, 56.02);
  else if (time < 57.24) point = travel(targets.settings, targets.language, time, 56.24, 56.89);
  else if (time < 58.12) point = travel(targets.language, targets.option, time, 57.24, 57.89);
  else point = travel(targets.option, exit, time, 58.12, 58.6);
  const mode = time >= 21.75 && time < 23.45 ? "col-resize"
    : time >= 9.063333 && time < 13.833333 ? "ibeam" : "arrow";
  const press = [9.063333, 14.216667, 56.083333, 57.05, 58.05].reduce((peak, at) =>
    Math.max(peak, smooth((time - at) / .06) * (1 - smooth((time - at - .06) / .09))), 0);
  return { ...point, mode, scale: 1 - press * .14, visible: time >= 5.2 && time < 58.666667 };
}

export function createFilmPointerTrack() {
  let lastTime = Infinity;
  let send: PointerPoint | undefined;
  return (time: number, targets: FilmPointerTargets, width: number, height: number) => {
    if (time < lastTime) send = undefined;
    lastTime = time;
    // After the click the camera follows the new message, sending the composer
    // below the viewport. The mouse must leave its last clicked SCREEN point,
    // not chase that now-offscreen button and reappear at the parking position.
    if (time <= 14.216667 || !send) send = targets.send;
    return filmPointerAt(time, { ...targets, send }, width, height);
  };
}
