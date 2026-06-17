import { ipcMain, type BrowserWindow } from "electron";

import {
  LYRA_CHANNELS,
  type ScreenshotPreviewEvent,
  type ScreenshotPreviewPresentRequest
} from "../../shared/desktop-bridge";
import { createScreenshotPlatformWatchers } from "./platform-watchers";
import { createScreenshotPreviewWindowController } from "./preview-window";
import { createScreenshotPreviewTempStore } from "./temp-image-store";
import type { ScreenshotPreviewImage } from "./types";

const createPreviewId = (): string =>
  `screenshot-preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const normalizePresentRequest = (
  request: ScreenshotPreviewPresentRequest
): ScreenshotPreviewImage | null => {
  const imageBase64 = request.imageBase64.trim();
  if (imageBase64.length === 0) {
    return null;
  }
  const mimeType = request.mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
  return {
    previewId: createPreviewId(),
    imageBase64,
    mimeType,
    ...(request.label === undefined ? {} : { label: request.label }),
    ...(request.source === undefined ? {} : { source: request.source }),
    ...(request.width === undefined ? {} : { width: request.width }),
    ...(request.height === undefined ? {} : { height: request.height }),
    ...(request.workspaceTabId === undefined ? {} : { workspaceTabId: request.workspaceTabId }),
    ...(request.workspaceTabTitle === undefined
      ? {}
      : { workspaceTabTitle: request.workspaceTabTitle }),
    ...(request.workspaceTabPageKind === undefined
      ? {}
      : { workspaceTabPageKind: request.workspaceTabPageKind }),
    ...(request.workspaceTabAddress === undefined
      ? {}
      : { workspaceTabAddress: request.workspaceTabAddress })
  };
};

export type ScreenshotPreviewIpcBridge = {
  readonly dispose: () => void;
};

export const createScreenshotPreviewIpcBridge = ({
  getWindow
}: {
  readonly getWindow: () => BrowserWindow | null;
}): ScreenshotPreviewIpcBridge => {
  const tempStore = createScreenshotPreviewTempStore();
  const previewWindow = createScreenshotPreviewWindowController();
  let suppressClipboardUntil = 0;
  let activePreview: ScreenshotPreviewImage | null = null;

  const publish = (event: ScreenshotPreviewEvent): void => {
    const window = getWindow();
    if (window !== null && window.isDestroyed() === false) {
      window.webContents.send(LYRA_CHANNELS.screenshotPreviewEvent, event);
    }
  };

  const presentPreview = async (preview: ScreenshotPreviewImage): Promise<void> => {
    const filePath = await tempStore.writePreviewImage(
      preview.previewId,
      preview.imageBase64,
      preview.mimeType
    );
    if (activePreview !== null && activePreview.previewId !== preview.previewId) {
      await tempStore.deletePreviewImage(activePreview.previewId);
    }
    activePreview = preview;
    suppressClipboardUntil = Date.now() + 2_500;
    previewWindow.present(preview, filePath, () => {
      publish({
        kind: "drag-started",
        previewId: preview.previewId
      });
    });
    publish({
      kind: "presented",
      previewId: preview.previewId
    });
  };

  const dismissActivePreview = async (): Promise<void> => {
    const previewId = activePreview?.previewId;
    previewWindow.dismiss();
    if (previewId !== undefined) {
      await tempStore.deletePreviewImage(previewId);
      publish({
        kind: "dismissed",
        previewId
      });
    }
    activePreview = null;
  };

  const platformWatchers = createScreenshotPlatformWatchers({
    suppressClipboardUntil: () => suppressClipboardUntil,
    onScreenshot: (snapshot) => {
      // macOS already shows the native bottom-right screenshot preview for drag-and-drop.
      // Lyra only needs to accept the drop in Composer; skip duplicating the floater here.
      if (process.platform === "darwin") {
        return;
      }
      const preview = normalizePresentRequest({
        imageBase64: snapshot.imageBase64,
        mimeType: snapshot.mimeType,
        label: snapshot.label,
        source: snapshot.source
      });
      if (preview === null) {
        return;
      }
      void presentPreview(preview);
    }
  });

  const presentHandler = async (
    _event: Electron.IpcMainInvokeEvent,
    request: ScreenshotPreviewPresentRequest
  ): Promise<{ readonly previewId: string | null }> => {
    const preview = normalizePresentRequest(request);
    if (preview === null) {
      return { previewId: null };
    }
    await presentPreview(preview);
    return { previewId: preview.previewId };
  };

  const dismissHandler = async (): Promise<void> => {
    await dismissActivePreview();
  };

  ipcMain.handle(LYRA_CHANNELS.screenshotPreviewPresent, presentHandler);
  ipcMain.handle(LYRA_CHANNELS.screenshotPreviewDismiss, dismissHandler);

  platformWatchers.start();

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.screenshotPreviewPresent);
      ipcMain.removeHandler(LYRA_CHANNELS.screenshotPreviewDismiss);
      platformWatchers.dispose();
      previewWindow.dispose();
      void tempStore.dispose();
    }
  };
};

