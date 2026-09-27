import { FILM_DURATION, clampFilmTime } from "./film-timeline";

// Silent playback has its own clock. Once enabled, audio becomes the single
// authority (including buffering), so sound and cuts cannot gradually drift.
export function advanceFilmClock(current: number, elapsed: number, audioTime: number | null) {
  const next = audioTime !== null && Number.isFinite(audioTime)
    // A seek/play promise may settle a frame later than the visual clock.
    // Hold until audio catches up; never rewind the imperative scene tape.
    ? Math.max(clampFilmTime(current), clampFilmTime(audioTime))
    : clampFilmTime(current + Math.max(0, Number.isFinite(elapsed) ? elapsed : 0));
  return { time: next, ended: next >= FILM_DURATION };
}
