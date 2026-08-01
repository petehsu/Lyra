import type {
  WorkspaceSearchEngineSelection,
  WorkspaceAppTabOpenRequest,
  WorkspaceTab,
  WorkspaceTabsConfig
} from "./types";
import {
  readWorkspaceAppVersionState,
  resolveWorkspaceApp
} from "../workspace-apps/registry";

export const SETTINGS_ADDRESS = "lyra://settings";
export const FALLBACK_TERMINAL_TITLE = "Terminal";

export const createTabId = (serial: number): string => `browser-tab-${serial}`;

export const toPageTitle = (address: string): string => {
  try {
    const parsed = new URL(address);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    const title = `${parsed.hostname}${path}`;
    return title.length > 0 ? title : parsed.hostname;
  } catch (_error) {
    return address;
  }
};

export const toSearchTitle = (query: string, maxLength: number): string => {
  const trimmed = query.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
};

export const createSearchTabWithId = (
  id: string,
  config: WorkspaceTabsConfig
): WorkspaceTab => ({
  id,
  title: config.homeTabTitle,
  pageKind: "search",
  inputValue: "",
  displayAddress: config.homeSearchAddress,
  faviconUrl: undefined,
  query: undefined
});

export const createSearchTab = (
  serial: number,
  config: WorkspaceTabsConfig
): WorkspaceTab => createSearchTabWithId(createTabId(serial), config);

export const createSettingsTabWithId = (
  id: string,
  config: WorkspaceTabsConfig
): WorkspaceTab => ({
  id,
  title: config.settingsTabTitle,
  pageKind: "settings",
  inputValue: "",
  displayAddress: SETTINGS_ADDRESS,
  faviconUrl: undefined,
  query: undefined
});

export const createSettingsTab = (
  serial: number,
  config: WorkspaceTabsConfig
): WorkspaceTab => createSettingsTabWithId(createTabId(serial), config);

export const createTerminalTabWithId = (
  id: string,
  terminalTabId: string,
  title: string
): WorkspaceTab => ({
  id,
  title,
  pageKind: "terminal",
  inputValue: "",
  displayAddress: `lyra://terminal/${terminalTabId}`,
  faviconUrl: undefined,
  query: undefined,
  terminalTabId
});

export const createTerminalTab = (
  serial: number,
  terminalTabId: string,
  title: string
): WorkspaceTab => createTerminalTabWithId(createTabId(serial), terminalTabId, title);

export const createAppTabWithId = (
  id: string,
  request: WorkspaceAppTabOpenRequest
): WorkspaceTab => {
  const descriptor = resolveWorkspaceApp(request.appId);
  const activeVersion = descriptor === undefined
    ? undefined
    : readWorkspaceAppVersionState(descriptor.componentId).active;
  return {
    id,
    title: request.title,
    pageKind: "app",
    inputValue: "",
    displayAddress: `lyra://app/${request.appId}/${request.appInstanceId}`,
    faviconUrl: undefined,
    query: undefined,
    appId: request.appId,
    appVersion: request.appVersion ?? activeVersion ?? "1.0.0",
    appInstanceId: request.appInstanceId,
    appIconKey: request.iconKey,
    appRoute: request.route ?? "/",
    appOpaqueState: request.opaqueState ?? {},
    ...(request.filePath === undefined ? {} : { filePath: request.filePath }),
    ...(request.fileSessionId === undefined
      ? {}
      : { fileSessionId: request.fileSessionId }),
    ...(request.isDirty === undefined ? {} : { isDirty: request.isDirty })
  };
};

export const createAppTab = (
  serial: number,
  request: WorkspaceAppTabOpenRequest
): WorkspaceTab => createAppTabWithId(createTabId(serial), request);

export const createPageTabWithId = (
  id: string,
  address: string,
  title?: string,
  search?: {
    readonly query: string;
    readonly source: "web";
    readonly engineId?: string;
    readonly selection?: WorkspaceSearchEngineSelection;
  }
): WorkspaceTab => ({
  id,
  title: title?.trim().length ? title.trim() : toPageTitle(address),
  pageKind: "page",
  inputValue: address,
  displayAddress: address,
  faviconUrl: undefined,
  query: undefined,
  ...(search === undefined
    ? {}
    : {
        searchQuery: search.query,
        searchSource: search.source,
        ...(search.engineId === undefined ? {} : { searchEngineId: search.engineId }),
        ...(search.selection === undefined
          ? {}
          : {
              searchEngineSelectionMode: search.selection.mode,
              searchSelectedEngineIds: search.selection.engineIds
            })
      })
});

export const createPageTab = (
  serial: number,
  address: string,
  title?: string
): WorkspaceTab => createPageTabWithId(createTabId(serial), address, title);

export const createWebSearchTabWithId = (
  id: string,
  query: string,
  address: string,
  config: WorkspaceTabsConfig,
  engineId?: string,
  title?: string,
  selection?: WorkspaceSearchEngineSelection
): WorkspaceTab =>
  createPageTabWithId(
    id,
    address,
    title?.trim().length ? title : toSearchTitle(query, config.maxSearchTitleLength),
    {
      query,
      source: "web",
      ...(engineId === undefined ? {} : { engineId }),
      ...(selection === undefined ? {} : { selection })
    }
  );

export const createWebSearchTab = (
  serial: number,
  query: string,
  address: string,
  config: WorkspaceTabsConfig,
  engineId?: string,
  title?: string,
  selection?: WorkspaceSearchEngineSelection
): WorkspaceTab =>
  createWebSearchTabWithId(
    createTabId(serial),
    query,
    address,
    config,
    engineId,
    title,
    selection
  );

export const createResultsTabWithId = (
  id: string,
  query: string,
  config: WorkspaceTabsConfig,
  selection?: WorkspaceSearchEngineSelection
): WorkspaceTab => ({
  id,
  title: toSearchTitle(query, config.maxSearchTitleLength),
  pageKind: "results",
  inputValue: query,
  displayAddress: `${config.homeSearchAddress}?q=${encodeURIComponent(query)}`,
  faviconUrl: undefined,
  query,
  searchQuery: query,
  searchSource: "web",
  ...(selection === undefined
    ? {}
    : {
        searchEngineSelectionMode: selection.mode,
        searchSelectedEngineIds: selection.engineIds
      })
});

export const createResultsTab = (
  serial: number,
  query: string,
  config: WorkspaceTabsConfig,
  selection?: WorkspaceSearchEngineSelection
): WorkspaceTab => createResultsTabWithId(createTabId(serial), query, config, selection);
