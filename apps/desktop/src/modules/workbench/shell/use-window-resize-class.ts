import { useEffect } from "react";

const WINDOW_RESIZING_CLASS = "lyra-window-resizing";
const WINDOW_RESIZE_SETTLE_MS = 150;

/**
 * Toggle `body.lyra-window-resizing` during native window-edge resize so CSS can
 * temporarily drop expensive backdrop-filter blur (see shell.scss resize-drag
 * blur drop). The class is added on the first resize event and removed a short
 * debounce after the last one — at rest the class is absent, so nothing visual
 * changes. Panel-splitter drags use `lyra-layout-resizing` (use-panel-layout.ts)
 * instead; this covers the OS window frame, which fires window "resize" events.
 */
export const useWindowResizeClass = (): void => {
  useEffect(() => {
    let settleTimer = 0;
    let active = false;

    const onResize = (): void => {
      if (!active) {
        active = true;
        document.body.classList.add(WINDOW_RESIZING_CLASS);
      }
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        active = false;
        document.body.classList.remove(WINDOW_RESIZING_CLASS);
      }, WINDOW_RESIZE_SETTLE_MS);
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(settleTimer);
      if (active) {
        document.body.classList.remove(WINDOW_RESIZING_CLASS);
      }
    };
  }, []);
};
