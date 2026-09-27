import { installPromoDesktopApi } from "./runtime/browser-desktop-api";
// Both entry branches share the same renderer. Keep the small, namespaced film
// layout in the entry CSS: Vite's conditional-import preload can otherwise keep
// only the site-main dependency list and omit film-main's stylesheet entirely.
import "../shots/003-opening-sequence/scene.css";
import "./film.css";

// Seed preferences before importing the renderer: locale-state reads them
// during module initialization. A saved demo locale must not override the URL.
const isFilm = new URLSearchParams(window.location.search).get("film") === "1";
const siteLocale = isFilm ? null : new URLSearchParams(window.location.search).get("locale");
if (siteLocale === "zh" || siteLocale === "en") {
  const locale = siteLocale === "zh" ? "zh-CN" : "en-US";
  const key = "lyra.promo.ui-studio.state.preferences";
  let preferences: Record<string, unknown> = {};
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    if (saved !== null && typeof saved === "object" && !Array.isArray(saved)) {
      preferences = saved as Record<string, unknown>;
    }
  } catch {
    // An unreadable previous preference record should not block the preview.
  }
  window.localStorage.setItem(key, JSON.stringify({
    ...preferences,
    ...(new URLSearchParams(location.search).get("theme") === "dark" ? { theme: "lyra-dark" }
      : new URLSearchParams(location.search).get("theme") === "light" ? { theme: "lyra-light" } : {}),
    locale,
    localePreference: { mode: "explicit", locale }
  }));
  document.documentElement.lang = locale;
}

const SITE_TAB_ID = "lyra-site-tab";
const workspaceState = {
  schemaVersion: 1,
  tabs: [{
    id: SITE_TAB_ID,
    title: "Lyra — Desktop Agent",
    pageKind: "page",
    inputValue: "https://lyra.ltd",
    displayAddress: "https://lyra.ltd",
    faviconUrl: "/lyra-mark.svg"
  }],
  activeTabId: SITE_TAB_ID,
  splitGroupTabIds: [],
  focusedSplitTabId: null
};

if (!isFilm) window.localStorage.setItem(
  "lyra.promo.ui-studio.state.workspace-tabs",
  JSON.stringify(workspaceState)
);

// Radix FocusScope can receive an iframe-realm proxy during the browser-only
// preview bootstrap. Chromium rejects that proxy even though it exposes a DOM
// node shape. Ignore only that exact observer target error; valid observers and
// every other exception keep their native behavior.
const nativeMutationObserve = MutationObserver.prototype.observe;
MutationObserver.prototype.observe = function observe(
  target: Node,
  options?: MutationObserverInit
) {
  try {
    nativeMutationObserve.call(this, target, options);
  } catch (error) {
    const errorRecord = error as { readonly message?: unknown; readonly name?: unknown };
    const isInvalidTarget = error !== null
      && typeof error === "object"
      && errorRecord.name === "TypeError"
      && String(errorRecord.message).includes("parameter 1 is not of type 'Node'");
    if (!isInvalidTarget) throw error;
  }
};

installPromoDesktopApi();

if (isFilm) void import("./film-main");
else void import("./site-main");
