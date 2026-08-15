import type { ShotDefinition } from "./shot-types";

type ShotRuntime = {
  readonly shot: ShotDefinition;
  readonly ready: Promise<void>;
  seek(timeMs: number): Promise<void>;
};

declare global {
  interface Window {
    __LYRA_PROMO_STUDIO__?: ShotRuntime;
  }
}

const nextPaint = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

const freezeDocumentAnimations = (timeMs: number): void => {
  document.documentElement.style.setProperty("--lyra-shot-time-ms", String(timeMs));
  for (const animation of document.getAnimations()) {
    animation.pause();
    try {
      animation.currentTime = timeMs;
    } catch {
      // Some browser-owned animations cannot be seeked; the scene controller can replace them.
    }
  }
};

export const installShotRuntime = (shot: ShotDefinition): void => {
  document.documentElement.dataset.lyraShot = shot.id;
  document.documentElement.dataset.lyraShotReady = "false";

  const ready = (async () => {
    await nextPaint();
    await shot.prepare?.();
    await document.fonts.ready;
    await nextPaint();
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    document.documentElement.dataset.lyraShotReady = "true";
  })();

  window.__LYRA_PROMO_STUDIO__ = {
    shot,
    ready,
    seek: async (timeMs: number) => {
      const safeTimeMs = Math.max(0, Math.min(timeMs, shot.durationSeconds * 1000));
      await shot.seek?.(safeTimeMs);
      freezeDocumentAnimations(safeTimeMs);
      await nextPaint();
    }
  };

  if (shot.seek !== undefined && new URLSearchParams(window.location.search).get("capture") !== "1") {
    void ready.then(() => {
      const startedAt = performance.now();
      const durationMs = shot.durationSeconds * 1000;
      const renderPreviewFrame = (now: number): void => {
        void shot.seek?.((now - startedAt) % durationMs);
        requestAnimationFrame(renderPreviewFrame);
      };
      requestAnimationFrame(renderPreviewFrame);
    });
  }
};
