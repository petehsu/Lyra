import gsap from "gsap";
import { FILM_DURATION, FILM_OUTRO } from "./film-timeline";

// The particles remain directly on the wallpaper. Reveal the panel only as
// the desktop starts appearing (source 5.6s), and finish with its entrance.
export const FILM_GLASS = { start: 5.2, duration: 2.4 } as const;

// Absolute audio-clock times, verified against frames in the exported film.
export const OUTRO_BEATS = {
  black: FILM_OUTRO,
  shrink: 66,
  words: [66.25, 67, 67.75, 68.5],
  settle: 69.5,
  name: 71.5,
  dissolve: 73,
  dissolved: 76
} as const;

export function createFilmOutro(scope: HTMLElement) {
  const find = (selector: string) => scope.querySelector(selector)!;
  const outro = find(".film-outro");
  const background = find(".film-outro-background");
  const glass = find(".film-glass");
  const mark = find(".film-outro-mark");
  const words = find(".film-outro-words");
  const name = find(".film-outro-name");
  const tl = gsap.timeline({ paused: true });
  tl.set(outro, { visibility: "hidden" }, 0)
    .set(background, { opacity: 1 }, 0)
    .set(glass, { autoAlpha: 0 }, 0)
    .to(glass, { autoAlpha: 1, duration: FILM_GLASS.duration, ease: "power1.inOut" }, FILM_GLASS.start)
    .set([words, name], { opacity: 0 }, 0)
    .set(mark, { scale: 1, opacity: 1 }, 0)
    .set(outro, { visibility: "visible" }, OUTRO_BEATS.black)
    // Large fixed raster size, then compositor-only downscaling. No filter,
    // no animated dimensions, no workbench reload during the musical cut.
    .to(mark, { scale: .025, duration: 3.5, ease: "none" }, OUTRO_BEATS.shrink)
    .to(glass, { autoAlpha: 0, duration: .25 }, OUTRO_BEATS.black);
  ["Anything", "Anytime", "Anywhere", "And more."].forEach((word, index) => {
    tl.set(words, { opacity: 1, textContent: word }, OUTRO_BEATS.words[index]);
  });
  tl.set(words, { opacity: 0 }, OUTRO_BEATS.settle)
    .to(mark, { opacity: 0, duration: .65, ease: "none" }, OUTRO_BEATS.name)
    .to(name, { opacity: 1, duration: 1, ease: "none" }, OUTRO_BEATS.name)
    .to(background, { opacity: 0, duration: 3, ease: "power1.inOut" }, OUTRO_BEATS.dissolve)
    .to({}, { duration: FILM_DURATION - OUTRO_BEATS.dissolved }, OUTRO_BEATS.dissolved);
  return tl;
}
