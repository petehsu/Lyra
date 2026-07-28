import { ipcRenderer } from "electron";

import {
  LYRA_CHANNELS,
  type LyraDesktopApi,
  type ScreenshotPreviewEvent,
  type WindowStatePayload
} from "../shared/desktop-bridge";

const screenshotPreviewEventListeners = new Set<(event: ScreenshotPreviewEvent) => void>();
let screenshotPreviewEventBridgeReady = false;

const ensureScreenshotPreviewEventBridge = (): void => {
  if (screenshotPreviewEventBridgeReady) {
    return;
  }
  screenshotPreviewEventBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.screenshotPreviewEvent,
    (_event: Electron.IpcRendererEvent, payload: ScreenshotPreviewEvent): void => {
      if (payload === null || typeof payload !== "object" || typeof payload.kind !== "string") {
        return;
      }
      for (const listener of screenshotPreviewEventListeners) {
        listener(payload);
      }
    }
  );
};

export const createShellBridgeApi = (): Pick<
  LyraDesktopApi,
  "windowControls" | "shellEvents" | "screenshotPreview"
> => ({
  windowControls: {
    minimize: () => ipcRenderer.invoke(LYRA_CHANNELS.minimizeWindow),
    toggleMaximize: () => ipcRenderer.invoke(LYRA_CHANNELS.toggleWindowMaximize),
    close: () => ipcRenderer.invoke(LYRA_CHANNELS.closeWindow),
    setThemeSource: (source) =>
      ipcRenderer.invoke(LYRA_CHANNELS.setWindowThemeSource, source)
  },
  shellEvents: {
    onWindowStateChange: (listener: (payload: WindowStatePayload) => void) => {
      const wrappedListener = (
        _event: Electron.IpcRendererEvent,
        payload: WindowStatePayload
      ): void => {
        listener(payload);
      };
      ipcRenderer.on(LYRA_CHANNELS.windowStateChanged, wrappedListener);
      return () => {
        ipcRenderer.removeListener(LYRA_CHANNELS.windowStateChanged, wrappedListener);
      };
    }
  },
  screenshotPreview: {
    present: (request) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.screenshotPreviewPresent,
        request
      ) as ReturnType<LyraDesktopApi["screenshotPreview"]["present"]>,
    dismiss: () => ipcRenderer.invoke(LYRA_CHANNELS.screenshotPreviewDismiss) as Promise<void>,
    onEvent: (listener: (event: ScreenshotPreviewEvent) => void) => {
      ensureScreenshotPreviewEventBridge();
      screenshotPreviewEventListeners.add(listener);
      return () => {
        screenshotPreviewEventListeners.delete(listener);
      };
    }
  }
});
