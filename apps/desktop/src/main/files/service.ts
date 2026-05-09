import { statSync } from "node:fs";
import { basename } from "node:path";

import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";

import { LYRA_CHANNELS } from "../../shared/desktop-bridge";
import type {
  FileManagerCreateFileRequest,
  FileManagerCreateFolderRequest,
  FileManagerEjectDeviceRequest,
  FileManagerFavoritesPayload,
  FileReadResult,
  FileReadTextRequest,
  FileStatRequest,
  FileManagerMountDeviceRequest,
  FileManagerMoveToTrashRequest,
  FileManagerReadDirectoryRequest,
  FileManagerRecentLocationsPayload,
  FileManagerRestoreFromTrashRequest,
  FileWriteTextRequest
} from "../../shared/file-manager";
import { loadFilesNativeBindings } from "./native-loader";
import type { FilesNativeBindings, FilesNativeLoadResult } from "./types";

const normalizePath = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("path is required");
  }
  return trimmed;
};

const normalizeName = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("name is required");
  }
  return trimmed;
};

const normalizeDirectoryRequest = (
  payload: FileManagerReadDirectoryRequest
): FileManagerReadDirectoryRequest => ({
  path: normalizePath(payload.path)
});

const normalizeUnsubscribeDirectoryRequest = (
  payload: { readonly subscriptionId?: string }
): { readonly subscriptionId: string } => {
  const subscriptionId = payload.subscriptionId?.trim() ?? "";
  if (subscriptionId.length === 0) {
    throw new Error("subscriptionId is required");
  }
  return { subscriptionId };
};

const normalizeCreateFileRequest = (
  payload: FileManagerCreateFileRequest
): FileManagerCreateFileRequest => ({
  parentPath: normalizePath(payload.parentPath),
  name: normalizeName(payload.name)
});

const normalizeCreateFolderRequest = (
  payload: FileManagerCreateFolderRequest
): FileManagerCreateFolderRequest => ({
  parentPath: normalizePath(payload.parentPath),
  name: normalizeName(payload.name)
});

const normalizeMoveToTrashRequest = (
  payload: FileManagerMoveToTrashRequest
): FileManagerMoveToTrashRequest => ({
  paths: payload.paths.map((entry) => normalizePath(entry))
});

const normalizeRestoreFromTrashRequest = (
  payload: FileManagerRestoreFromTrashRequest
): FileManagerRestoreFromTrashRequest => ({
  itemIds: payload.itemIds.map((entry) => normalizePath(entry))
});

const normalizeEjectDeviceRequest = (
  payload: FileManagerEjectDeviceRequest
): FileManagerEjectDeviceRequest => {
  const devicePath =
    typeof payload.devicePath === "string" && payload.devicePath.trim().length > 0
      ? normalizePath(payload.devicePath)
      : null;

  return {
    mountPath: normalizePath(payload.mountPath),
    kind: payload.kind,
    ...(devicePath === null ? {} : { devicePath })
  };
};

const normalizeMountDeviceRequest = (
  payload: FileManagerMountDeviceRequest
): FileManagerMountDeviceRequest => ({
  devicePath: normalizePath(payload.devicePath),
  kind: payload.kind
});

const normalizeFavoritesPayload = (
  payload: FileManagerFavoritesPayload
): FileManagerFavoritesPayload => ({
  favorites: payload.favorites.map((item) => ({
    ...item,
    title: normalizeName(item.title),
    path: normalizePath(item.path)
  }))
});

const normalizeRecentPayload = (
  payload: FileManagerRecentLocationsPayload
): FileManagerRecentLocationsPayload => ({
  recentLocations: payload.recentLocations.map((item) => ({
    ...item,
    title: normalizeName(item.title),
    path: normalizePath(item.path),
    lastOpenedAt: item.lastOpenedAt.trim().length > 0 ? item.lastOpenedAt.trim() : new Date().toISOString()
  }))
});

const normalizeReadTextRequest = (
  payload: FileReadTextRequest
): FileReadTextRequest => ({
  path: normalizePath(payload.path)
});

const isVirtualToolPath = (filePath: string): boolean =>
  filePath === "/tools" || filePath.startsWith("/tools/");

const unsupportedReadResult = (
  filePath: string,
  reason: string,
  sizeBytes = 0
): FileReadResult => ({
  kind: "unsupported",
  path: filePath,
  reason,
  readOnly: true,
  sizeBytes
});

const safeReadTextFile = (
  bindings: FilesNativeBindings,
  payload: FileReadTextRequest
): FileReadResult => {
  const request = normalizeReadTextRequest(payload);
  if (isVirtualToolPath(request.path)) {
    return unsupportedReadResult(request.path, "virtual-tool-path");
  }
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(request.path);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT"
      || (error as NodeJS.ErrnoException).code === "ENOTDIR"
    ) {
      return unsupportedReadResult(request.path, "not-found");
    }
    throw error;
  }
  if (!stats.isFile()) {
    return unsupportedReadResult(request.path, "not-file", stats.size);
  }
  try {
    return bindings.readTextFile(request);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return unsupportedReadResult(request.path, "not-found");
    }
    throw error;
  }
};

const normalizeWriteTextRequest = (
  payload: FileWriteTextRequest
): FileWriteTextRequest => {
  const encoding = payload.encoding;
  if (
    encoding !== undefined &&
    encoding !== "utf8" &&
    encoding !== "utf8-bom"
  ) {
    throw new Error("encoding is unsupported");
  }
  const expectedRevision =
    typeof payload.expectedRevision === "string" &&
    payload.expectedRevision.trim().length > 0
      ? payload.expectedRevision.trim()
      : undefined;

  return {
    path: normalizePath(payload.path),
    content:
      typeof payload.content === "string"
        ? payload.content
        : String(payload.content ?? ""),
    ...(expectedRevision === undefined
      ? {}
      : { expectedRevision }),
    ...(encoding === undefined ? {} : { encoding })
  };
};

const normalizeStatRequest = (
  payload: FileStatRequest
): FileStatRequest => ({
  path: normalizePath(payload.path)
});

export type FilesIpcBridge = {
  readonly dispose: () => void;
  readonly loadResult: Extract<FilesNativeLoadResult, { readonly ok: true }>;
  readonly nativeBindings: FilesNativeBindings;
};

export const createFilesIpcBridge = (storageRoot: string): FilesIpcBridge => {
  const loadResult = loadFilesNativeBindings();
  if (loadResult.ok === false) {
    throw new Error(
      `files native unavailable: ${loadResult.errorMessage}\ntried paths:\n${loadResult.triedPaths.join("\n")}`
    );
  }
  const bindings = loadResult.bindings;
  let patchPoller: ReturnType<typeof setInterval> | null = null;
  const subscriptionsByWebContents = new Map<number, Set<string>>();

  const broadcastDirectoryPatches = (): void => {
    let patches;
    try {
      patches = bindings.pollDirectoryPatches();
    } catch {
      return;
    }
    if (patches.length === 0) {
      return;
    }
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.webContents.isDestroyed()) {
        continue;
      }
      for (const patch of patches) {
        window.webContents.send(LYRA_CHANNELS.filesDirectoryPatch, patch);
      }
    }
  };

  const ensurePatchPoller = (): void => {
    if (patchPoller !== null) {
      return;
    }
    patchPoller = setInterval(broadcastDirectoryPatches, 50);
  };

  const maybeStopPatchPoller = (): void => {
    if (patchPoller === null || subscriptionsByWebContents.size > 0) {
      return;
    }
    clearInterval(patchPoller);
    patchPoller = null;
  };

  const trackDirectorySubscription = (
    event: IpcMainInvokeEvent,
    subscriptionId: string
  ): void => {
    const webContentsId = event.sender.id;
    const current = subscriptionsByWebContents.get(webContentsId) ?? new Set<string>();
    current.add(subscriptionId);
    subscriptionsByWebContents.set(webContentsId, current);
    event.sender.once("destroyed", () => {
      const subscriptions = subscriptionsByWebContents.get(webContentsId);
      subscriptionsByWebContents.delete(webContentsId);
      if (subscriptions !== undefined) {
        for (const id of subscriptions) {
          try {
            bindings.unsubscribeDirectory({ subscriptionId: id });
          } catch {
            // Best effort cleanup for closing renderer processes.
          }
        }
      }
      maybeStopPatchPoller();
    });
    ensurePatchPoller();
  };

  const untrackDirectorySubscription = (
    event: IpcMainInvokeEvent,
    subscriptionId: string
  ): void => {
    const subscriptions = subscriptionsByWebContents.get(event.sender.id);
    if (subscriptions !== undefined) {
      subscriptions.delete(subscriptionId);
      if (subscriptions.size === 0) {
        subscriptionsByWebContents.delete(event.sender.id);
      }
    }
    maybeStopPatchPoller();
  };

  const handlers: Array<readonly [string, (_event: IpcMainInvokeEvent, payload?: unknown) => unknown]> = [
    [
      LYRA_CHANNELS.filesReadHome,
      () => bindings.readHome({ storageRoot })
    ],
    [
      LYRA_CHANNELS.filesReadDirectory,
      (_event, payload) =>
        bindings.readDirectory(normalizeDirectoryRequest(payload as FileManagerReadDirectoryRequest))
    ],
    [
      LYRA_CHANNELS.filesSubscribeDirectory,
      (event, payload) => {
        const response = bindings.subscribeDirectory(
          normalizeDirectoryRequest(payload as FileManagerReadDirectoryRequest)
        );
        trackDirectorySubscription(event, response.subscriptionId);
        return response;
      }
    ],
    [
      LYRA_CHANNELS.filesUnsubscribeDirectory,
      (event, payload) => {
        const request = normalizeUnsubscribeDirectoryRequest(
          payload as { readonly subscriptionId?: string }
        );
        bindings.unsubscribeDirectory(request);
        untrackDirectorySubscription(event, request.subscriptionId);
      }
    ],
    [
      LYRA_CHANNELS.filesReadTrash,
      () => bindings.readTrash({ storageRoot })
    ],
    [
      LYRA_CHANNELS.filesCreateFile,
      (_event, payload) =>
        bindings.createFile(normalizeCreateFileRequest(payload as FileManagerCreateFileRequest))
    ],
    [
      LYRA_CHANNELS.filesCreateFolder,
      (_event, payload) =>
        bindings.createFolder(normalizeCreateFolderRequest(payload as FileManagerCreateFolderRequest))
    ],
    [
      LYRA_CHANNELS.filesMoveToTrash,
      (_event, payload) =>
        bindings.moveToTrash({
          ...normalizeMoveToTrashRequest(payload as FileManagerMoveToTrashRequest),
          storageRoot
        })
    ],
    [
      LYRA_CHANNELS.filesRestoreFromTrash,
      (_event, payload) =>
        bindings.restoreFromTrash({
          ...normalizeRestoreFromTrashRequest(payload as FileManagerRestoreFromTrashRequest),
          storageRoot
        })
    ],
    [
      LYRA_CHANNELS.filesEmptyTrash,
      () => bindings.emptyTrash({ storageRoot })
    ],
    [
      LYRA_CHANNELS.filesMountDevice,
      (_event, payload) =>
        bindings.mountDevice(normalizeMountDeviceRequest(payload as FileManagerMountDeviceRequest))
    ],
    [
      LYRA_CHANNELS.filesEjectDevice,
      (_event, payload) =>
        bindings.ejectDevice(normalizeEjectDeviceRequest(payload as FileManagerEjectDeviceRequest))
    ],
    [
      LYRA_CHANNELS.filesReadFavorites,
      () => bindings.readFavorites({ storageRoot })
    ],
    [
      LYRA_CHANNELS.filesWriteFavorites,
      (_event, payload) =>
        bindings.writeFavorites({ storageRoot, ...normalizeFavoritesPayload(payload as FileManagerFavoritesPayload) })
    ],
    [
      LYRA_CHANNELS.filesReadRecentLocations,
      () => bindings.readRecentLocations({ storageRoot })
    ],
    [
      LYRA_CHANNELS.filesWriteRecentLocations,
      (_event, payload) =>
        bindings.writeRecentLocations({ storageRoot, ...normalizeRecentPayload(payload as FileManagerRecentLocationsPayload) })
    ],
    [
      LYRA_CHANNELS.filesReadTextFile,
      (_event, payload) =>
        safeReadTextFile(bindings, payload as FileReadTextRequest)
    ],
    [
      LYRA_CHANNELS.filesWriteTextFile,
      (_event, payload) =>
        bindings.writeTextFile(normalizeWriteTextRequest(payload as FileWriteTextRequest))
    ],
    [
      LYRA_CHANNELS.filesStatFile,
      (_event, payload) =>
        bindings.statFile(normalizeStatRequest(payload as FileStatRequest))
    ],
    [
      LYRA_CHANNELS.filesSelectAttachments,
      async () => {
        const result = await dialog.showOpenDialog({
          properties: ["openFile", "multiSelections"]
        });
        if (result.canceled) {
          return [];
        }
        return result.filePaths.map((filePath) => ({
          name: basename(filePath),
          path: filePath,
          kind: "file" as const
        }));
      }
    ],
    [
      LYRA_CHANNELS.filesSelectDirectories,
      async () => {
        const result = await dialog.showOpenDialog({
          properties: ["openDirectory", "multiSelections"]
        });
        if (result.canceled) {
          return [];
        }
        return result.filePaths.map((filePath) => ({
          name: basename(filePath),
          path: filePath,
          kind: "directory" as const
        }));
      }
    ]
  ];

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, handler);
  }

  return {
    loadResult,
    nativeBindings: bindings,
    dispose: () => {
      for (const [channel] of handlers) {
        ipcMain.removeHandler(channel);
      }
      if (patchPoller !== null) {
        clearInterval(patchPoller);
        patchPoller = null;
      }
      subscriptionsByWebContents.clear();
    }
  };
};
