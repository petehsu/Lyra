import type { WebContents } from "electron";

export const LUMEN_HOST_ACTION_TIMEOUT_MS = 180_000;
export const LUMEN_VISION_MAX_DIMENSION_PX = 2_000;

export const LUMEN_INTEGRATION_CHECKLIST = [
  "Wait for page_ready (document complete + not loading) after navigation before returning success.",
  "Downsample vision captures to <= 2000px on the longest edge before model input.",
  "Treat browser_script / observe windows as short-lived; remap after navigation or frame reload.",
  "Read large host JSON responses incrementally when streaming from lyrad/SDK stdout.",
  "Prefer targetRef + semantic map before coordinate-only visual actions."
] as const;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const waitForPageReady = async (
  webContents: WebContents,
  timeoutMs: number
): Promise<boolean> => {
  if (webContents.isDestroyed()) {
    return false;
  }
  const deadline = Date.now() + Math.max(100, timeoutMs);
  while (Date.now() < deadline) {
    try {
      const readyState = await webContents.executeJavaScript("document.readyState", true);
      if (readyState === "complete" && webContents.isLoading() === false) {
        return true;
      }
    } catch {
      return false;
    }
    await sleep(50);
  }
  return false;
};

export const clampHostActionTimeoutMs = (
  timeoutMs: number | undefined,
  ceilingMs: number = LUMEN_HOST_ACTION_TIMEOUT_MS
): number =>
  Math.max(250, Math.min(ceilingMs, timeoutMs ?? ceilingMs));