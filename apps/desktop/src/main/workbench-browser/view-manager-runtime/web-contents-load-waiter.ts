import type { WebContents } from "electron";

type PendingPageLoadWait = {
  readonly cancel: () => void;
};

const stopWebContentsLoading = (webContents: WebContents): void => {
  if (webContents.isDestroyed()) {
    return;
  }
  try {
    webContents.stop();
  } catch {
    // Ignore Electron teardown races.
  }
};

export const createWebContentsLoadWaiter = () => {
  const pendingPageLoadWaits = new WeakMap<WebContents, PendingPageLoadWait>();

  const cancelPendingLoad = (webContents: WebContents): void => {
    pendingPageLoadWaits.get(webContents)?.cancel();
  };

  const waitForLoad = async (
    webContents: WebContents,
    url: string,
    timeoutMs: number
  ): Promise<void> => {
    if (webContents.isDestroyed()) {
      return;
    }
    cancelPendingLoad(webContents);
    await new Promise<void>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let waitRecord: PendingPageLoadWait | null = null;
      const finish = (stopLoading: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer !== null) {
          clearTimeout(timer);
        }
        webContents.off("did-stop-loading", onStopLoading);
        webContents.off("did-fail-load", onFailLoad);
        webContents.off("destroyed", onDestroyed);
        if (waitRecord !== null && pendingPageLoadWaits.get(webContents) === waitRecord) {
          pendingPageLoadWaits.delete(webContents);
        }
        if (stopLoading) {
          stopWebContentsLoading(webContents);
        }
        resolve();
      };
      const onStopLoading = (): void => finish(false);
      const onFailLoad = (): void => finish(false);
      const onDestroyed = (): void => finish(false);
      waitRecord = {
        cancel: () => finish(true)
      };
      pendingPageLoadWaits.set(webContents, waitRecord);
      timer = setTimeout(() => finish(true), Math.max(250, timeoutMs));
      webContents.on("did-stop-loading", onStopLoading);
      webContents.on("did-fail-load", onFailLoad);
      webContents.on("destroyed", onDestroyed);
      void webContents.loadURL(url).then(onStopLoading, onFailLoad);
    });
  };

  return {
    cancelPendingLoad,
    waitForLoad
  };
};
