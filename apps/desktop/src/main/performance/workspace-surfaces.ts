import type { WorkbenchStateKey } from "../../shared/desktop-bridge";
import type { LyraPerformanceResourceDescriptor } from "../../shared/performance-kernel";
import type { LyraPerformanceResourceScheduler } from "./service";

type WorkbenchStateReader = {
  readonly readState: (key: WorkbenchStateKey) => string | null;
  readonly subscribe: (
    listener: (event: {
      readonly key: WorkbenchStateKey;
      readonly json: string | null;
    }) => void
  ) => () => void;
};

type WorkspaceTabRecord = {
  readonly id: string;
  readonly title: string;
  readonly pageKind: string;
  readonly inputValue: string;
  readonly displayAddress: string;
  readonly query?: string;
  readonly searchMode?: string;
  readonly resultMode?: string;
  readonly terminalTabId?: string;
  readonly appId?: string;
  readonly appInstanceId?: string;
  readonly filePath?: string;
  readonly isDirty?: boolean;
  readonly browserRestoreState?: {
    readonly history?: {
      readonly entries?: readonly unknown[];
    };
    readonly formDraft?: {
      readonly editedFieldCount?: number;
      readonly passwordFieldCount?: number;
      readonly sensitiveFieldCount?: number;
    };
    readonly storage?: {
      readonly cookieCount?: number;
      readonly localStorage?: string;
      readonly sessionStorage?: string;
      readonly indexedDB?: string;
    };
  };
};

type WorkspaceTabsSnapshot = {
  readonly tabs: readonly WorkspaceTabRecord[];
  readonly activeTabId: string | null;
  readonly splitGroupTabIds: readonly string[];
  readonly focusedSplitTabId: string | null;
};

const WORKSPACE_TABS_STATE_KEY = "workspace-tabs" as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const readString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

const readBoolean = (record: Record<string, unknown>, key: string): boolean | undefined => {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
};

const readStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

const normalizeMode = (value: string | undefined): "standard" | "deep" =>
  value === "deep" ? "deep" : "standard";

const normalizeWorkspaceTab = (value: unknown): WorkspaceTabRecord | null => {
  if (isRecord(value) === false) {
    return null;
  }
  const id = readString(value, "id");
  const pageKind = readString(value, "pageKind");
  if (id === undefined || pageKind === undefined) {
    return null;
  }
  const browserRestoreState = isRecord(value.browserRestoreState)
    ? value.browserRestoreState as WorkspaceTabRecord["browserRestoreState"]
    : undefined;
  const query = readString(value, "query");
  const terminalTabId = readString(value, "terminalTabId");
  const appId = readString(value, "appId");
  const appInstanceId = readString(value, "appInstanceId");
  const filePath = readString(value, "filePath");
  const isDirty = readBoolean(value, "isDirty");
  return {
    id,
    title: readString(value, "title") ?? id,
    pageKind,
    inputValue: readString(value, "inputValue") ?? "",
    displayAddress: readString(value, "displayAddress") ?? "",
    ...(query === undefined ? {} : { query }),
    searchMode: normalizeMode(readString(value, "searchMode")),
    resultMode: normalizeMode(readString(value, "resultMode")),
    ...(terminalTabId === undefined ? {} : { terminalTabId }),
    ...(appId === undefined ? {} : { appId }),
    ...(appInstanceId === undefined ? {} : { appInstanceId }),
    ...(filePath === undefined ? {} : { filePath }),
    ...(isDirty === undefined ? {} : { isDirty }),
    ...(browserRestoreState === undefined ? {} : { browserRestoreState })
  };
};

export const parseWorkspaceTabsSnapshot = (json: string | null): WorkspaceTabsSnapshot => {
  if (json === null || json.trim().length === 0) {
    return {
      tabs: [],
      activeTabId: null,
      splitGroupTabIds: [],
      focusedSplitTabId: null
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      tabs: [],
      activeTabId: null,
      splitGroupTabIds: [],
      focusedSplitTabId: null
    };
  }
  if (isRecord(parsed) === false) {
    return {
      tabs: [],
      activeTabId: null,
      splitGroupTabIds: [],
      focusedSplitTabId: null
    };
  }

  return {
    tabs: Array.isArray(parsed.tabs)
      ? parsed.tabs
          .map(normalizeWorkspaceTab)
          .filter((tab): tab is WorkspaceTabRecord => tab !== null)
      : [],
    activeTabId: readString(parsed, "activeTabId") ?? null,
    splitGroupTabIds: readStringArray(parsed.splitGroupTabIds),
    focusedSplitTabId: readString(parsed, "focusedSplitTabId") ?? null
  };
};

const stableAddress = (tab: WorkspaceTabRecord): string => {
  const address = tab.displayAddress.trim();
  if (address.length > 0) {
    return address;
  }
  return tab.pageKind;
};

const workspaceSurfaceCoreKey = (tab: WorkspaceTabRecord): string => {
  switch (tab.pageKind) {
    case "search": {
      const input = tab.inputValue.trim();
      return input.length === 0
        ? `workspace:search:${stableAddress(tab)}:${tab.searchMode}`
        : `workspace:search:draft:${tab.id}`;
    }
    case "results": {
      return `workspace:results:${tab.resultMode}:${tab.query ?? tab.inputValue}`;
    }
    case "settings": {
      return "workspace:settings";
    }
    case "terminal": {
      return `workspace:terminal:${tab.terminalTabId ?? tab.id}`;
    }
    case "app": {
      return `workspace:app:${tab.appId ?? "unknown"}:${tab.appInstanceId ?? tab.filePath ?? tab.id}`;
    }
    case "page": {
      return `workspace:page:${stableAddress(tab)}`;
    }
    default: {
      return `workspace:${tab.pageKind}:${stableAddress(tab)}`;
    }
  }
};

const workspaceSurfaceSignature = (tab: WorkspaceTabRecord): string =>
  [
    tab.pageKind,
    stableAddress(tab),
    tab.query ?? "",
    tab.searchMode ?? "",
    tab.resultMode ?? "",
    tab.appId ?? "",
    tab.filePath ?? ""
  ].join("|");

const workspaceResourceKind = (
  tab: WorkspaceTabRecord
): LyraPerformanceResourceDescriptor["kind"] => {
  switch (tab.pageKind) {
    case "terminal":
      return "terminalPane";
    case "app":
      return "pluginSurface";
    default:
      return "workspaceSurface";
  }
};

const readRestoreStateNumber = (
  record: WorkspaceTabRecord["browserRestoreState"] | undefined,
  path: readonly string[]
): number => {
  let cursor: unknown = record;
  for (const segment of path) {
    if (isRecord(cursor) === false) {
      return 0;
    }
    cursor = cursor[segment];
  }
  return typeof cursor === "number" && Number.isFinite(cursor) ? cursor : 0;
};

const hasAvailableStorage = (
  record: WorkspaceTabRecord["browserRestoreState"] | undefined
): boolean => {
  const storage = record?.storage;
  return storage?.localStorage === "available"
    || storage?.sessionStorage === "available"
    || storage?.indexedDB === "available";
};

export const workspaceTabToPerformanceResource = (
  tab: WorkspaceTabRecord,
  snapshot: Pick<WorkspaceTabsSnapshot, "activeTabId" | "splitGroupTabIds" | "focusedSplitTabId">,
  now = Date.now()
): LyraPerformanceResourceDescriptor => {
  const active = tab.id === snapshot.activeTabId || tab.id === snapshot.focusedSplitTabId;
  const visible = active || snapshot.splitGroupTabIds.includes(tab.id);
  const trimmedInput = tab.inputValue.trim();
  const hasSearchDraft = tab.pageKind === "search" && trimmedInput.length > 0;
  const formEditedFields = readRestoreStateNumber(tab.browserRestoreState, ["formDraft", "editedFieldCount"]);
  const passwordFields = readRestoreStateNumber(tab.browserRestoreState, ["formDraft", "passwordFieldCount"]);
  const sensitiveFields = readRestoreStateNumber(tab.browserRestoreState, ["formDraft", "sensitiveFieldCount"]);
  const historyEntries = tab.browserRestoreState?.history?.entries?.length ?? 0;
  const cookieCount = readRestoreStateNumber(tab.browserRestoreState, ["storage", "cookieCount"]);

  return {
    resourceId: `workspaceSurface:${tab.id}`,
    kind: workspaceResourceKind(tab),
    coreKey: workspaceSurfaceCoreKey(tab),
    stateKey: `workspace-state:${tab.id}`,
    lifecycle: active ? "foreground" : visible ? "visible" : "hotHidden",
    visible,
    active,
    signals: {
      hasUserInput: hasSearchDraft,
      hasFormDraft: hasSearchDraft || formEditedFields > 0 || tab.isDirty === true,
      hasDivergentHistory: historyEntries > 1
    },
    isolation: {
      requiresDedicatedCore: tab.pageKind === "terminal" || tab.pageKind === "app",
      containsSensitiveInput: passwordFields > 0 || sensitiveFields > 0,
      authenticatedSession: cookieCount > 0,
      crossOriginState: hasAvailableStorage(tab.browserRestoreState)
    },
    sharedSignature: workspaceSurfaceSignature(tab),
    updatedAt: now
  };
};

export const createLyraWorkspaceSurfacePerformanceSync = ({
  workbenchState,
  performanceScheduler
}: {
  readonly workbenchState: WorkbenchStateReader;
  readonly performanceScheduler: LyraPerformanceResourceScheduler;
}): { readonly dispose: () => void; readonly syncNow: () => void } => {
  const registeredResourceIds = new Set<string>();
  let disposed = false;

  const syncJson = (json: string | null): void => {
    if (disposed) {
      return;
    }
    const snapshot = parseWorkspaceTabsSnapshot(json);
    const nextResourceIds = new Set<string>();
    const now = Date.now();
    for (const tab of snapshot.tabs) {
      const resource = workspaceTabToPerformanceResource(tab, snapshot, now);
      nextResourceIds.add(resource.resourceId);
      performanceScheduler.updateResource(resource);
    }
    for (const resourceId of registeredResourceIds) {
      if (nextResourceIds.has(resourceId)) {
        continue;
      }
      performanceScheduler.unregisterResource(resourceId);
    }
    registeredResourceIds.clear();
    for (const resourceId of nextResourceIds) {
      registeredResourceIds.add(resourceId);
    }
  };

  const syncNow = (): void => {
    syncJson(workbenchState.readState(WORKSPACE_TABS_STATE_KEY));
  };
  const unsubscribe = workbenchState.subscribe((event) => {
    if (event.key !== WORKSPACE_TABS_STATE_KEY) {
      return;
    }
    syncJson(event.json);
  });

  syncNow();

  return {
    syncNow,
    dispose: () => {
      disposed = true;
      unsubscribe();
      for (const resourceId of registeredResourceIds) {
        performanceScheduler.unregisterResource(resourceId);
      }
      registeredResourceIds.clear();
    }
  };
};
