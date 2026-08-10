import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

import type {
  LoginManagerSnapshot,
  LyraDesktopApi,
  UiuxListPacksResponse
} from "../../../shared/desktop-bridge";
import type { BrowserSettingsCategoryId } from "../browser-tabs/settings-surface-types";
import type { FileManagerModel } from "../file-manager";
import type { ImageViewerModel } from "../image-viewer";
import type { SoftwareStoreLabels } from "../software-store/types";
import type { TerminalDockModel } from "../terminal-dock/types";
import type { WorkspaceTabsModel } from "../workspace-tabs";
import type { SoftwareCapabilitiesRegistryModel } from "./types";
import { createBuiltinHandlers } from "./builtin-actions";
import {
  createBuiltinSoftware,
  isHighRiskCapability,
  trustedExternalSoftware
} from "./manifest";
import { useSoftwareCapabilitiesQueryRegistry } from "./query-registry";
import {
  createSoftwareStateReaders,
  redactedLoginManagerSnapshot
} from "./state-readers";

type UseSoftwareCapabilitiesRegistryArgs = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: SoftwareStoreLabels;
  readonly activeUiPackId: string;
  readonly tabsModel: WorkspaceTabsModel;
  readonly fileManagerModel: FileManagerModel;
  readonly imageViewerModel?: ImageViewerModel;
  readonly terminalModel?: TerminalDockModel;
  readonly onOpenSettingsSection: (categoryId: BrowserSettingsCategoryId) => void;
};

export const useSoftwareCapabilitiesRegistry = ({
  desktopApi,
  labels,
  activeUiPackId,
  tabsModel,
  fileManagerModel,
  imageViewerModel,
  terminalModel,
  onOpenSettingsSection
}: UseSoftwareCapabilitiesRegistryArgs): SoftwareCapabilitiesRegistryModel => {
  const [packs, setPacks] = useState<UiuxListPacksResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginManagerSnapshot, setLoginManagerSnapshot] =
    useState<LoginManagerSnapshot | null>(null);

  const builtinSoftware = useMemo(() => createBuiltinSoftware(labels), [labels]);
  const externalSoftware = useMemo(
    () => trustedExternalSoftware(packs, activeUiPackId),
    [activeUiPackId, packs]
  );
  const software = useMemo(
    () => [...builtinSoftware, ...externalSoftware],
    [builtinSoftware, externalSoftware]
  );

  const stateReaders = useMemo(() => createSoftwareStateReaders({
    desktopApi,
    tabsModel,
    fileManagerModel,
    imageViewerModel,
    terminalModel,
    loginManagerSnapshot,
    software
  }), [
    desktopApi,
    fileManagerModel,
    imageViewerModel,
    loginManagerSnapshot,
    software,
    tabsModel,
    terminalModel
  ]);

  const updateLoginManagerSnapshot = useCallback((snapshot: LoginManagerSnapshot) => {
    setLoginManagerSnapshot(snapshot);
    return redactedLoginManagerSnapshot(snapshot);
  }, []);

  const refreshLoginManagerState = useCallback(async () => {
    if (desktopApi?.loginManager === undefined) {
      setLoginManagerSnapshot(null);
      return redactedLoginManagerSnapshot(null);
    }
    const snapshot = await desktopApi.loginManager.list();
    return updateLoginManagerSnapshot(snapshot);
  }, [desktopApi, updateLoginManagerSnapshot]);

  useEffect(() => {
    if (desktopApi?.loginManager === undefined) {
      setLoginManagerSnapshot(null);
      return undefined;
    }
    void refreshLoginManagerState().catch(() => {
      setLoginManagerSnapshot(null);
    });
    return desktopApi.loginManager.onEvent((event) => {
      setLoginManagerSnapshot(event.snapshot);
    });
  }, [desktopApi, refreshLoginManagerState]);

  const refresh = useCallback(async (): Promise<void> => {
    if (desktopApi?.uiux === undefined) {
      setPacks(null);
      setError(labels.unavailable);
      return;
    }
    setLoading(true);
    try {
      setPacks(await desktopApi.uiux.listPacks());
      setError(null);
    } catch (loadError: unknown) {
      setPacks(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [desktopApi, labels.unavailable]);

  useEffect(() => {
    void refresh();
  }, [refresh, activeUiPackId]);

  const builtinHandlers = useMemo(() => createBuiltinHandlers({
    desktopApi,
    labels,
    tabsModel,
    fileManagerModel,
    imageViewerModel,
    software,
    stateReaders,
    refreshLoginManagerState,
    updateLoginManagerSnapshot,
    refreshSoftwarePacks: refresh,
    onOpenSettingsSection
  }), [
    desktopApi,
    fileManagerModel,
    imageViewerModel,
    labels,
    onOpenSettingsSection,
    refresh,
    refreshLoginManagerState,
    software,
    stateReaders,
    tabsModel,
    updateLoginManagerSnapshot
  ]);

  const {
    handlerRevision,
    handleBridgeQuery,
    createUiPackCapabilities
  } = useSoftwareCapabilitiesQueryRegistry({
    activeUiPackId,
    software,
    builtinHandlers,
    readSoftwareState: stateReaders.readSoftwareState
  });

  const publishedSoftware = useMemo(
    () => [...software],
    [handlerRevision, software]
  );

  useEffect(() => {
    if (desktopApi?.softwareCapabilities === undefined) {
      return undefined;
    }
    return desktopApi.softwareCapabilities.registerHandler(handleBridgeQuery);
  }, [desktopApi, handleBridgeQuery]);

  return {
    software: publishedSoftware,
    loading,
    error,
    refresh,
    handleBridgeQuery,
    createUiPackCapabilities
  };
};

export { isHighRiskCapability };
