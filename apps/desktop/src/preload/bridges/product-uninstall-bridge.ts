import { ipcRenderer } from "electron";

import {
  LYRA_CHANNELS,
  type LyraDesktopApi,
  type ProductUninstallProgress
} from "../../shared/desktop-bridge";

export const createProductUninstallBridgeApi = (): Pick<LyraDesktopApi, "productUninstall"> => ({
  productUninstall: {
    run: (request) => ipcRenderer.invoke(LYRA_CHANNELS.appUninstallProduct, request),
    onProgress: (listener) => {
      const wrappedListener = (
        _event: Electron.IpcRendererEvent,
        progress: ProductUninstallProgress
      ): void => {
        listener(progress);
      };
      ipcRenderer.on(LYRA_CHANNELS.appUninstallProgress, wrappedListener);
      return () => {
        ipcRenderer.removeListener(LYRA_CHANNELS.appUninstallProgress, wrappedListener);
      };
    },
    onOpenRequested: (listener) => {
      const wrappedListener = (): void => {
        listener();
      };
      ipcRenderer.on(LYRA_CHANNELS.appUninstallOpen, wrappedListener);
      return () => {
        ipcRenderer.removeListener(LYRA_CHANNELS.appUninstallOpen, wrappedListener);
      };
    },
    registerEntry: () => ipcRenderer.invoke(LYRA_CHANNELS.appRegisterUninstall)
  }
});
