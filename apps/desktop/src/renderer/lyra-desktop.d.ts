import type { LyraDesktopApi } from "../shared/desktop-bridge";

declare global {
  interface Window {
    lyraDesktop: LyraDesktopApi;
  }
}

export {};
