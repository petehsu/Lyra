import { createRoot } from "react-dom/client";
import i18n from "@workbench/i18n/i18n-instance";
import { filmChinese } from "./runtime/film-language";
import { installFilmInteractions } from "./runtime/film-interaction";
import { installFilmCursor } from "./runtime/film-cursor";
import shot, { OpeningSequenceScene, seekOpeningFilm } from "../shots/003-opening-sequence/scene";
import { filmSourceTime, FILM_OUTRO, clampFilmTime } from "../../../web/site/lib/film-timeline";
import "@fontsource/geist-sans/latin.css";
import "@fontsource/geist-mono/latin.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource/zen-dots/latin.css";
import "@renderer/styles/index.scss";
import "./studio.css";
import "./film.css";

const params = new URLSearchParams(location.search);
i18n.addResourceBundle("zh-CN", "translation", filmChinese, true, true);
document.documentElement.dataset.film = "true";
document.documentElement.dataset.filmTheme = params.get("theme") === "dark" ? "dark" : "light";
const root = createRoot(document.getElementById("app")!);
root.render(<OpeningSequenceScene />);
const removeInteractions = installFilmInteractions();
const cursor = installFilmCursor();
window.addEventListener("pagehide", () => { removeInteractions(); cursor.dispose(); }, { once: true });
const paint = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
let ready = false;
let last = -1;
const render = (seconds: number) => {
  if (seconds === last) return;
  last = seconds;
  // The original scene remains mounted, but does no work behind the end card.
  if (seconds < FILM_OUTRO) {
    seekOpeningFilm(filmSourceTime(seconds), seconds);
    cursor.refresh();
  }
};

window.addEventListener("message", event => {
  if (event.source !== window.parent || event.origin !== location.origin || !ready) return;
  if (event.data?.type !== "lyra-film-tick" || typeof event.data.time !== "number" || !Number.isFinite(event.data.time)) return;
  render(clampFilmTime(event.data.time));
});

async function prepare() {
  await document.fonts.ready;
  // Allow the real renderer, session subscriptions and terminal to mount.
  for (let i = 0; i < 6; i++) await paint();
  await shot.prepare();
  const target = clampFilmTime(Number(params.get("start") ?? 0));
  if (target < FILM_OUTRO) {
    // Rebuild state from a fresh isolated renderer on seek, never reverse a list
    // of imperative clicks. React commits between checkpoints before the next action.
    for (let time = 0; time < target; time += 0.5) {
      render(time);
      await paint();
    }
    render(target);
    await paint();
  }
  ready = true;
  document.documentElement.dataset.filmReady = "true";
  window.parent.postMessage({ type: "lyra-film-ready" }, location.origin);
}
void prepare().catch(() => window.parent.postMessage({ type: "lyra-film-error" }, location.origin));
