import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";

import {
  LYRA_CHANNELS,
  type ImageViewerCloseSessionRequest,
  type ImageViewerEvent,
  type ImageViewerOpenRequest,
  type ImageViewerOpenResult,
  type ImageViewerReadTileRequest,
  type ImageViewerTileResponse
} from "../../shared/desktop-bridge";
import { loadImageViewerNativeBindings } from "./native-loader";
import type { ImageViewerIpcBridge } from "./types";

const normalizeString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
};

const normalizeInteger = (value: unknown, fieldName: string): number => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    throw new Error(`${fieldName} must be a finite number`);
  }
  return Math.max(0, Math.round(value));
};

const normalizeOptionalString = (value: unknown, fieldName: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const toFilePreviewUrl = (filePath: string, mimeType: string): string =>
  `lyra-file://preview?path=${encodeURIComponent(filePath)}&contentType=${encodeURIComponent(mimeType)}`;

const normalizeOpenRequest = (request: ImageViewerOpenRequest): ImageViewerOpenRequest => ({
  path: normalizeString(request.path, "path")
});

const normalizeReadTileRequest = (
  request: ImageViewerReadTileRequest
): ImageViewerReadTileRequest => {
  const generationId = normalizeOptionalString(request.generationId, "generationId");
  return {
    sessionId: normalizeString(request.sessionId, "sessionId"),
    level: normalizeInteger(request.level, "level"),
    tileX: normalizeInteger(request.tileX, "tileX"),
    tileY: normalizeInteger(request.tileY, "tileY"),
    ...(generationId === undefined ? {} : { generationId })
  };
};

const normalizeCloseSessionRequest = (
  request: ImageViewerCloseSessionRequest
): ImageViewerCloseSessionRequest => ({
  sessionId: normalizeString(request.sessionId, "sessionId")
});

const withSourceUrl = (result: ImageViewerOpenResult): ImageViewerOpenResult => ({
  ...result,
  sourceUrl: result.sourceUrl.trim().length > 0
    ? result.sourceUrl
    : toFilePreviewUrl(result.path, result.mimeType)
});

const publishImageViewerEvent = (event: ImageViewerEvent): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue;
    }
    window.webContents.send(LYRA_CHANNELS.imageViewerEvent, event);
  }
};

export const createImageViewerIpcBridge = (storageRoot: string): ImageViewerIpcBridge => {
  const loadResult = loadImageViewerNativeBindings();
  if (loadResult.ok === false) {
    throw new Error(
      `image viewer native unavailable: ${loadResult.errorMessage}\ntried paths:\n${loadResult.triedPaths.join("\n")}`
    );
  }
  const bindings = loadResult.bindings;

  const handlers = [
    [
      LYRA_CHANNELS.imageViewerOpenImage,
      async (_event: IpcMainInvokeEvent, payload: unknown) => {
        const request = normalizeOpenRequest(payload as ImageViewerOpenRequest);
        const openResult = withSourceUrl(await bindings.openImage({ ...request, storageRoot }));
        publishImageViewerEvent({
          kind: "session-status",
          sessionId: openResult.sessionId,
          generationId: openResult.generationId,
          status: "ready"
        });
        if (openResult.cacheState === "importing") {
          publishImageViewerEvent({
            kind: "import-progress",
            sessionId: openResult.sessionId,
            generationId: openResult.generationId,
            cacheId: openResult.cacheId,
            progress: openResult.importProgress,
            message: "Preparing image cache"
          });
        } else if (openResult.cacheId.length > 0) {
          publishImageViewerEvent({
            kind: "cache-ready",
            sessionId: openResult.sessionId,
            generationId: openResult.generationId,
            cacheId: openResult.cacheId
          });
        }
        return openResult;
      }
    ],
    [
      LYRA_CHANNELS.imageViewerReadTile,
      async (_event: IpcMainInvokeEvent, payload: unknown): Promise<ImageViewerTileResponse> =>
        bindings.readTile(normalizeReadTileRequest(payload as ImageViewerReadTileRequest))
    ],
    [
      LYRA_CHANNELS.imageViewerCloseSession,
      async (_event: IpcMainInvokeEvent, payload: unknown) => {
        const request = normalizeCloseSessionRequest(payload as ImageViewerCloseSessionRequest);
        await bindings.closeSession(request);
        publishImageViewerEvent({
          kind: "session-status",
          sessionId: request.sessionId,
          generationId: "",
          status: "closed"
        });
      }
    ]
  ] as const;

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, handler);
  }

  return {
    loadResult,
    nativeBindings: bindings,
    publishEvent: publishImageViewerEvent,
    dispose: () => {
      for (const [channel] of handlers) {
        ipcMain.removeHandler(channel);
      }
    }
  };
};
