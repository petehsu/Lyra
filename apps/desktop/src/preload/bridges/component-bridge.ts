import { ipcRenderer } from "electron";

import {
  LYRA_CHANNELS,
  type ComponentUpdateProgress,
  type LyraDesktopApi
} from "../../shared/desktop-bridge";

export const createComponentsBridgeApi = (): Pick<LyraDesktopApi, "components"> => ({
  components: {
    list: () => ipcRenderer.invoke(LYRA_CHANNELS.componentsList),
    resolveAppModule: (request) =>
      ipcRenderer.invoke(LYRA_CHANNELS.componentsResolveAppModule, request),
    installFromDirectory: (request) =>
      ipcRenderer.invoke(LYRA_CHANNELS.componentsInstallFromDirectory, request),
    assessActivation: (componentId) =>
      ipcRenderer.invoke(LYRA_CHANNELS.componentsAssessActivation, componentId),
    activate: (request) =>
      ipcRenderer.invoke(LYRA_CHANNELS.componentsActivate, request),
    rollback: (componentId) =>
      ipcRenderer.invoke(LYRA_CHANNELS.componentsRollback, componentId),
    uninstallVersion: (request) =>
      ipcRenderer.invoke(LYRA_CHANNELS.componentsUninstallVersion, request),
    stageUpdate: (request) =>
      ipcRenderer.invoke(LYRA_CHANNELS.componentsStageUpdate, request),
    cancelUpdate: () => ipcRenderer.invoke(LYRA_CHANNELS.componentsCancelUpdate),
    readCoreProjectionStatus: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.componentsCoreProjectionStatus),
    applyCore: (request) => ipcRenderer.invoke(LYRA_CHANNELS.componentsApplyCore, request),
    onUpdateProgress: (listener) => {
      const wrappedListener = (
        _event: Electron.IpcRendererEvent,
        progress: ComponentUpdateProgress
      ): void => {
        listener(progress);
      };
      ipcRenderer.on(LYRA_CHANNELS.componentsUpdateProgress, wrappedListener);
      return () => {
        ipcRenderer.removeListener(LYRA_CHANNELS.componentsUpdateProgress, wrappedListener);
      };
    }
  }
});
