import type { BrowserWindow } from "electron";

import { createFilesIpcBridge } from "./files";
import { createImageViewerIpcBridge } from "./image-viewer";
import { createIdentityIpcBridge } from "./identity";
import { createLoginManagerIpcBridge } from "./login-manager";
import { createSensitiveValuesIpcBridge } from "./sensitive-values";

export const createStorageBackedIpcBridges = ({
  fileManagerStorageRoot,
  imageViewerStorageRoot,
  identityStorageRoot,
  loginManagerStorageRoot,
  createPreviewUrl,
  addAllowedRoot,
  getWindow
}: {
  readonly fileManagerStorageRoot: string;
  readonly imageViewerStorageRoot: string;
  readonly identityStorageRoot: string;
  readonly loginManagerStorageRoot: string;
  readonly createPreviewUrl: (path: string) => string;
  readonly addAllowedRoot: (path: string) => void;
  readonly getWindow: () => BrowserWindow | null;
}) => {
  const files = createFilesIpcBridge(fileManagerStorageRoot, {
    createPreviewUrl
  });
  console.info(`[lyra-files] native loaded: ${files.loadResult.loadedFrom}`);

  const imageViewer = createImageViewerIpcBridge(imageViewerStorageRoot, {
    createPreviewUrl
  });
  console.info(`[lyra-image-viewer] native loaded: ${imageViewer.loadResult.loadedFrom}`);

  const identity = createIdentityIpcBridge(identityStorageRoot, {
    createPreviewUrl,
    addAllowedRoot
  });
  const loginManager = createLoginManagerIpcBridge({
    storageRoot: loginManagerStorageRoot,
    getWindow
  });
  const sensitiveValues = createSensitiveValuesIpcBridge({
    loginManager
  });

  return {
    files,
    imageViewer,
    identity,
    loginManager,
    sensitiveValues
  };
};
