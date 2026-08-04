import { validateWorkspaceTabV2, type JsonValue } from "@lyra/app-runtime";

import { readWorkbenchStateSync, writeWorkbenchStateSync } from "../state-storage";
import { sanitizeBrowserPageRestoreState } from "../../../shared/workbench-browser";
import type { WorkspaceTabsRuntimeState } from "./runtime-state";
import { createSearchTab } from "./tab-factory";
import { resolveRuntimeState } from "./split-model";
import type {
  WorkspaceTab,
  WorkspaceTabsConfig,
  WorkspaceTabsSessionSnapshot
} from "./types";

const WORKBENCH_STATE_KEY = "workspace-tabs" as const;
export const WORKSPACE_TABS_SESSION_SCHEMA_VERSION = 1 as const;
const isVirtualToolPath = (value: string): boolean =>
  value === "/tools" || value.startsWith("/tools/");

export const createInitialRuntimeState = (
  config: WorkspaceTabsConfig
): WorkspaceTabsRuntimeState => {
  const initialTab = createSearchTab(1, config);
  return {
    tabs: [initialTab],
    activeTabId: initialTab.id,
    splitGroupTabIds: [],
    focusedSplitTabId: null
  };
};

export const toSnapshot = (
  state: WorkspaceTabsRuntimeState
): WorkspaceTabsSessionSnapshot => ({
  schemaVersion: WORKSPACE_TABS_SESSION_SCHEMA_VERSION,
  tabs: state.tabs,
  activeTabId: state.activeTabId,
  splitGroupTabIds: state.splitGroupTabIds,
  focusedSplitTabId: state.focusedSplitTabId
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isWorkspaceTabPageKind = (value: unknown): value is WorkspaceTab["pageKind"] =>
  value === "search" ||
  value === "results" ||
  value === "page" ||
  value === "settings" ||
  value === "terminal" ||
  value === "app";

const sanitizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const sanitizeOptionalBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const sanitizeSearchSource = (
  value: unknown
): WorkspaceTab["searchSource"] | undefined =>
  value === "web" ? value : undefined;

const sanitizeSearchEngineSelectionMode = (
  value: unknown
): WorkspaceTab["searchEngineSelectionMode"] | undefined =>
  value === "auto" || value === "manual" ? value : undefined;

const sanitizeStringArray = (value: unknown): readonly string[] | undefined => {
  if (Array.isArray(value) === false) {
    return undefined;
  }
  const items = value
    .map((entry) => sanitizeOptionalString(entry))
    .filter((entry): entry is string => entry !== undefined);
  return items.length > 0 ? [...new Set(items)] : undefined;
};

const isJsonValue = (value: unknown, ancestors = new Set<object>()): boolean => {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object" || value === null || ancestors.has(value)) {
    return false;
  }
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, ancestors))
    : Object.getPrototypeOf(value) === Object.prototype
      && Object.values(value).every((item) => isJsonValue(item, ancestors));
  ancestors.delete(value);
  return valid;
};

const sanitizeOpaqueState = (
  value: unknown
): JsonValue | undefined =>
  isJsonValue(value) ? value as JsonValue : undefined;

export const sanitizePersistedTab = (value: unknown): WorkspaceTab | null => {
  if (isRecord(value) === false) {
    return null;
  }

  const id = sanitizeOptionalString(value.id);
  const title = sanitizeOptionalString(value.title);
  const pageKind = value.pageKind;
  const inputValue = typeof value.inputValue === "string" ? value.inputValue : null;
  const displayAddress =
    typeof value.displayAddress === "string" ? value.displayAddress : null;

  if (
    id === undefined ||
    title === undefined ||
    isWorkspaceTabPageKind(pageKind) === false ||
    inputValue === null ||
    displayAddress === null
  ) {
    return null;
  }

  const faviconUrl = sanitizeOptionalString(value.faviconUrl);
  const query = sanitizeOptionalString(value.query);
  const terminalTabId = sanitizeOptionalString(value.terminalTabId);
  const appId = sanitizeOptionalString(value.appId);
  const appVersion = sanitizeOptionalString(value.appVersion);
  const appInstanceId = sanitizeOptionalString(value.appInstanceId);
  const appIconKey = sanitizeOptionalString(value.appIconKey);
  const appRoute = sanitizeOptionalString(value.appRoute);
  const appOpaqueState = sanitizeOpaqueState(value.appOpaqueState);
  const rawFilePath = sanitizeOptionalString(value.filePath);
  const filePath =
    rawFilePath === undefined || isVirtualToolPath(rawFilePath)
      ? undefined
      : rawFilePath;
  const fileSessionId = sanitizeOptionalString(value.fileSessionId);
  const isDirty = sanitizeOptionalBoolean(value.isDirty);
  const browserRestoreState = sanitizeBrowserPageRestoreState(value.browserRestoreState);
  const searchQuery = sanitizeOptionalString(value.searchQuery);
  const searchSource = sanitizeSearchSource(value.searchSource);
  const searchEngineId = sanitizeOptionalString(value.searchEngineId);
  const searchEngineSelectionMode = sanitizeSearchEngineSelectionMode(
    value.searchEngineSelectionMode
  );
  const searchSelectedEngineIds = sanitizeStringArray(value.searchSelectedEngineIds);

  if (pageKind === "terminal" && terminalTabId === undefined) {
    return null;
  }

  if (
    pageKind === "app"
    && (
      appId === undefined
      || appVersion === undefined
      || appInstanceId === undefined
      || appRoute === undefined
      || appOpaqueState === undefined
    )
  ) {
    return null;
  }

  if (
    pageKind === "app"
    && !validateWorkspaceTabV2({
      schemaVersion: 2,
      appId,
      appVersion,
      instanceId: appInstanceId,
      route: appRoute,
      opaqueState: appOpaqueState
    })
  ) {
    return null;
  }

  return {
    id,
    title,
    pageKind,
    inputValue,
    displayAddress,
    faviconUrl,
    query,
    ...(terminalTabId === undefined ? {} : { terminalTabId }),
    ...(appId === undefined ? {} : { appId }),
    ...(appVersion === undefined ? {} : { appVersion }),
    ...(appInstanceId === undefined ? {} : { appInstanceId }),
    ...(appIconKey === undefined
      ? {}
      : { appIconKey: appIconKey as NonNullable<WorkspaceTab["appIconKey"]> }),
    ...(appRoute === undefined ? {} : { appRoute }),
    ...(appOpaqueState === undefined ? {} : { appOpaqueState }),
    ...(filePath === undefined ? {} : { filePath }),
    ...(fileSessionId === undefined ? {} : { fileSessionId }),
    ...(isDirty === undefined ? {} : { isDirty }),
    ...(browserRestoreState === undefined ? {} : { browserRestoreState }),
    ...(searchQuery === undefined ? {} : { searchQuery }),
    ...(searchSource === undefined ? {} : { searchSource }),
    ...(searchEngineId === undefined ? {} : { searchEngineId }),
    ...(searchEngineSelectionMode === undefined ? {} : { searchEngineSelectionMode }),
    ...(searchSelectedEngineIds === undefined ? {} : { searchSelectedEngineIds })
  };
};

export const sanitizePersistedSnapshot = (
  value: unknown,
  config: WorkspaceTabsConfig
): WorkspaceTabsRuntimeState | null => {
  if (isRecord(value) === false) {
    return null;
  }

  if (
    value.schemaVersion !== WORKSPACE_TABS_SESSION_SCHEMA_VERSION
    || Array.isArray(value.tabs) === false
    || typeof value.activeTabId !== "string"
  ) {
    return null;
  }

  const tabs = value.tabs
    .map((tab) => sanitizePersistedTab(tab))
    .filter((tab): tab is WorkspaceTab => tab !== null);

  if (tabs.length === 0) {
    return null;
  }

  const splitGroupTabIds = Array.isArray(value.splitGroupTabIds)
    ? value.splitGroupTabIds
        .filter((tabId): tabId is string => typeof tabId === "string")
        .map((tabId) => tabId.trim())
        .filter((tabId) => tabId.length > 0)
    : [];

  const focusedSplitTabId =
    typeof value.focusedSplitTabId === "string" && value.focusedSplitTabId.trim().length > 0
      ? value.focusedSplitTabId.trim()
      : null;

  return resolveRuntimeState(
    {
      tabs,
      activeTabId: value.activeTabId,
      splitGroupTabIds,
      focusedSplitTabId
    },
    config
  );
};

export const readPersistedState = (
  config: WorkspaceTabsConfig
): WorkspaceTabsRuntimeState => {
  if (typeof window === "undefined") {
    return createInitialRuntimeState(config);
  }

  const raw = readWorkbenchStateSync(WORKBENCH_STATE_KEY);
  if (raw === null) {
    return createInitialRuntimeState(config);
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return sanitizePersistedSnapshot(parsed, config) ?? createInitialRuntimeState(config);
  } catch {
    return createInitialRuntimeState(config);
  }
};

export const writePersistedState = (state: WorkspaceTabsRuntimeState): void => {
  if (typeof window === "undefined") {
    return;
  }
  writeWorkbenchStateSync(WORKBENCH_STATE_KEY, JSON.stringify(toSnapshot(state)));
};

export const resolveNextSerial = (tabs: readonly WorkspaceTab[]): number => {
  const maxSerial = tabs.reduce((maxValue, tab) => {
    const match = /^browser-tab-(\d+)$/.exec(tab.id);
    if (match === null) {
      return maxValue;
    }
    const serial = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(serial) === false) {
      return maxValue;
    }
    return Math.max(maxValue, serial);
  }, 0);
  return maxSerial + 1;
};
