import type { WebThemeSnapshot } from "./types";

/**
 * The "area-based retinting" stage — Stage 3 in the web-theme pipeline.
 *
 * Runs after Dark Reader and the fallback-remap finish. Scans a curated list
 * of structural candidates, computes each candidate's viewport-area ratio,
 * and recolors/kills-gradient on the ones that look like "page background"
 * based on pure geometry (not class name guessing).
 *
 * The heuristic is intentionally shallow and fast:
 *   - ratio ≥ LARGE_RATIO and (gradient OR light bg) → kill gradient + paint bg
 *   - ratio ≥ MID_RATIO and gradient                  → kill gradient only
 *   - otherwise                                       → leave alone
 *
 * Design tenets:
 *   - Never scan the whole DOM; only structural candidates (~20-100 elements).
 *   - Coalesce via requestAnimationFrame so multiple triggers share one pass.
 *   - Mark what we touched with data attributes so we can cleanly undo on
 *     disable, and so repeated passes are idempotent.
 *   - All state lives on `window` for the hot-swap + disable helpers.
 */

export type AreaRetintThresholds = {
  /**
   * Minimum viewport-area ratio required before we will *recolor* an element
   * to the Lyra app background. Intentionally conservative: something has to
   * visibly dominate the viewport before we treat it as "page background".
   */
  readonly largeRatio: number;
  /**
   * Minimum viewport-area ratio required before we will strip a gradient
   * image (without touching the element's background-color). Covers the
   * "cream gradient on a mid-sized hero band" shape.
   */
  readonly midRatio: number;
};

export const DEFAULT_AREA_RETINT_THRESHOLDS: AreaRetintThresholds = {
  largeRatio: 0.4,
  midRatio: 0.2
} as const;

export type AreaRetintAction =
  | "none"
  | "remove-image"
  | "recolor-and-remove-image";

/**
 * Pure classifier used both in the injected script (templated) and in unit
 * tests so we can verify threshold behavior without a browser.
 */
export const classifyAreaAction = (
  ratio: number,
  hasGradient: boolean,
  hasLightBg: boolean,
  thresholds: AreaRetintThresholds = DEFAULT_AREA_RETINT_THRESHOLDS
): AreaRetintAction => {
  if (ratio < thresholds.midRatio) {
    return "none";
  }
  if (ratio >= thresholds.largeRatio && (hasGradient || hasLightBg)) {
    return "recolor-and-remove-image";
  }
  if (hasGradient) {
    return "remove-image";
  }
  return "none";
};

export type BuildAreaRetintScriptInput = {
  readonly snapshot: WebThemeSnapshot;
  readonly thresholds?: AreaRetintThresholds;
  /**
   * Hard cap on how many candidates we ever read bounding rects for.
   * Defaults to 200 — more than enough for any realistic site layout.
   */
  readonly candidateCap?: number;
};

/**
 * JS candidate selector used inside the injected script. Kept narrow so the
 * scan stays O(dozens), not O(thousands).
 */
export const AREA_RETINT_CANDIDATE_SELECTOR = [
  "body > *",
  "main",
  "section",
  "article",
  "header",
  "footer",
  "[role=main]",
  "[role=banner]",
  "[role=region]",
  "[role=contentinfo]",
  "[class*=layout]",
  "[class*=wrapper]",
  "[class*=container]",
  "[class*=hero]",
  "[class*=landing]",
  "[class*=page]"
].join(", ");

export const AREA_RETINT_MARK_ATTR = "data-lyra-area-retint";
export const AREA_RETINT_SIG_ATTR = "data-lyra-area-retint-sig";

export const buildAreaRetintScript = ({
  snapshot,
  thresholds = DEFAULT_AREA_RETINT_THRESHOLDS,
  candidateCap = 200
}: BuildAreaRetintScriptInput): string => {
  const initJson = JSON.stringify(snapshot);
  const largeRatio = JSON.stringify(thresholds.largeRatio);
  const midRatio = JSON.stringify(thresholds.midRatio);
  const candidateSelector = JSON.stringify(AREA_RETINT_CANDIDATE_SELECTOR);
  const cap = JSON.stringify(Math.max(10, Math.min(candidateCap, 2000)));
  const markAttr = JSON.stringify(AREA_RETINT_MARK_ATTR);
  const sigAttr = JSON.stringify(AREA_RETINT_SIG_ATTR);

  return `
(() => {
  try {
    if (window.__lyraAreaRetintInstalled === true) { return; }
    window.__lyraAreaRetintInstalled = true;

    const LARGE_RATIO = ${largeRatio};
    const MID_RATIO = ${midRatio};
    const CANDIDATE_SELECTOR = ${candidateSelector};
    const CANDIDATE_CAP = ${cap};
    const ATTR_MARK = ${markAttr};
    const ATTR_SIG = ${sigAttr};

    let currentSnapshot = ${initJson};
    let running = currentSnapshot && currentSnapshot.enabled === true;
    let passScheduled = false;
    let mutationDebounceTimer = null;
    let resizeDebounceTimer = null;
    let mutationObserver = null;

    const isLightRgba = (value) => {
      if (typeof value !== "string" || value.length === 0) { return false; }
      const parts = value.match(
        /rgba?\\(\\s*([-+\\d.]+)[,\\s]+([-+\\d.]+)[,\\s]+([-+\\d.]+)(?:[,\\s/]+([-+\\d.]+%?))?/
      );
      if (!parts) { return false; }
      const r = parseFloat(parts[1]);
      const g = parseFloat(parts[2]);
      const b = parseFloat(parts[3]);
      let alpha = 1;
      if (typeof parts[4] === "string") {
        const raw = parts[4];
        alpha = raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw);
      }
      if (!isFinite(r) || !isFinite(g) || !isFinite(b) || !isFinite(alpha)) { return false; }
      if (alpha < 0.2) { return false; }
      const toLinear = (c) => {
        const v = Math.max(0, Math.min(255, c)) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      const lum = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
      return lum > 0.5;
    };

    const classify = (ratio, hasGradient, hasLightBg) => {
      if (ratio < MID_RATIO) { return "none"; }
      if (ratio >= LARGE_RATIO && (hasGradient || hasLightBg)) {
        return "recolor-and-remove-image";
      }
      if (hasGradient) { return "remove-image"; }
      return "none";
    };

    const resetElement = (el) => {
      if (!(el instanceof HTMLElement)) { return; }
      el.style.removeProperty("background-image");
      el.style.removeProperty("background-color");
      el.removeAttribute(ATTR_MARK);
      el.removeAttribute(ATTR_SIG);
    };

    const runPass = () => {
      if (!running) { return; }
      const snapshot = currentSnapshot;
      if (!snapshot || snapshot.enabled !== true) { return; }
      const palette = snapshot.palette;
      if (!palette) { return; }
      const bgApp = typeof palette.bgApp === "string" ? palette.bgApp : null;
      if (!bgApp) { return; }

      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      const viewportArea = Math.max(1, vw * vh);
      if (viewportArea < 10000) { return; }

      const candidatesRaw = document.querySelectorAll(CANDIDATE_SELECTOR);
      const candidatesLen = Math.min(candidatesRaw.length, CANDIDATE_CAP);

      for (let idx = 0; idx < candidatesLen; idx += 1) {
        const el = candidatesRaw[idx];
        if (!(el instanceof HTMLElement)) { continue; }
        if (el.getAttribute("data-lyra-web-theme")) { continue; }
        if (el.closest("[data-lyra-web-theme]")) { continue; }

        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) {
          if (el.hasAttribute(ATTR_MARK)) { resetElement(el); }
          continue;
        }
        const ratio = (rect.width * rect.height) / viewportArea;

        const cs = getComputedStyle(el);
        const bgImage = cs.backgroundImage || "";
        const bgColor = cs.backgroundColor || "";
        const hasGradient = bgImage.indexOf("gradient") >= 0;
        const hasLightBg = isLightRgba(bgColor);

        const action = classify(ratio, hasGradient, hasLightBg);
        if (action === "none") {
          if (el.hasAttribute(ATTR_MARK)) { resetElement(el); }
          continue;
        }

        const signature = [
          action,
          ratio.toFixed(2),
          bgApp
        ].join("|");
        if (el.getAttribute(ATTR_SIG) === signature) { continue; }

        if (action === "recolor-and-remove-image") {
          el.style.setProperty("background-color", bgApp, "important");
          el.style.setProperty("background-image", "none", "important");
        } else {
          el.style.setProperty("background-image", "none", "important");
        }
        el.setAttribute(ATTR_MARK, ratio.toFixed(2));
        el.setAttribute(ATTR_SIG, signature);
      }
    };

    const schedulePass = () => {
      if (!running || passScheduled) { return; }
      passScheduled = true;
      const fn = () => {
        passScheduled = false;
        try { runPass(); } catch (_err) { /* non-fatal */ }
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(fn);
      } else {
        setTimeout(fn, 16);
      }
    };

    const startMutationObserver = () => {
      if (mutationObserver || !document.documentElement) { return; }
      mutationObserver = new MutationObserver(() => {
        if (mutationDebounceTimer !== null) { return; }
        mutationDebounceTimer = setTimeout(() => {
          mutationDebounceTimer = null;
          schedulePass();
        }, 250);
      });
      try {
        mutationObserver.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: false
        });
      } catch (_err) {
        mutationObserver = null;
      }
    };

    const stopMutationObserver = () => {
      if (mutationObserver) {
        try { mutationObserver.disconnect(); } catch (_err) {}
      }
      mutationObserver = null;
      if (mutationDebounceTimer !== null) {
        clearTimeout(mutationDebounceTimer);
        mutationDebounceTimer = null;
      }
    };

    const onResize = () => {
      if (resizeDebounceTimer !== null) {
        clearTimeout(resizeDebounceTimer);
      }
      resizeDebounceTimer = setTimeout(() => {
        resizeDebounceTimer = null;
        schedulePass();
      }, 500);
    };

    const disableAll = () => {
      running = false;
      stopMutationObserver();
      const marked = document.querySelectorAll("[" + ATTR_MARK + "]");
      for (let i = 0; i < marked.length; i += 1) {
        const el = marked[i];
        if (el instanceof HTMLElement) { resetElement(el); }
      }
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        schedulePass();
        startMutationObserver();
      }, { once: true });
    } else {
      schedulePass();
      startMutationObserver();
    }
    window.addEventListener("load", schedulePass, { once: true });
    window.addEventListener("resize", onResize);

    window.__lyraAreaRetintUpdate = (next) => {
      if (!next || typeof next !== "object") { return; }
      if (next.enabled === false) {
        currentSnapshot = next;
        disableAll();
        return;
      }
      currentSnapshot = next;
      running = true;
      if (!mutationObserver) { startMutationObserver(); }
      schedulePass();
    };
  } catch (_bootErr) {
    /* non-fatal; other stages still do their job. */
  }
})();
`.trim();
};

export const buildAreaRetintUpdateScript = (
  snapshot: WebThemeSnapshot
): string => {
  const json = JSON.stringify(snapshot);
  return `
(() => {
  try {
    if (typeof window.__lyraAreaRetintUpdate === "function") {
      window.__lyraAreaRetintUpdate(${json});
    }
  } catch (_err) {}
})();
`.trim();
};

export const buildAreaRetintDisableScript = (): string => `
(() => {
  try {
    if (typeof window.__lyraAreaRetintUpdate === "function") {
      window.__lyraAreaRetintUpdate({ enabled: false });
    }
  } catch (_err) {}
})();
`.trim();
