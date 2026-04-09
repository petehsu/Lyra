import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readWorkbenchStateSync, writeWorkbenchStateSync } from "../state-storage";
import type {
  WorkspaceAppTabMetaRequest,
  WorkspaceAppTabOpenRequest,
  WorkspaceSearchMode,
  WorkspaceTabInsertOptions,
  WorkspaceTab,
  WorkspaceTabPageMeta,
  WorkspaceTabPageRuntimeState,
  WorkspaceTabsConfig,
  WorkspaceTabsModel,
  WorkspaceTabsOptions,
  WorkspaceTabsSessionSnapshot
} from "./types";

const URL_OR_DOMAIN_PATTERN = /^(https?:\/\/|[\w.-]+\.[a-z]{2,}(\/|$))/i;
const SETTINGS_ADDRESS = "lyra://settings";
const FALLBACK_TERMINAL_TITLE = "Terminal";
const WORKBENCH_STATE_KEY = "workspace-tabs" as const;
const MAX_SPLIT_TAB_COUNT = 4;
const VALID_WORKSPACE_APP_IDS = new Set([
  "file-manager",
  "file-editor",
  "ai-history",
  "ai-mcp",
  "ai-skills",
  "notification-center"
] as const);

type WorkspaceTabsRuntimeState = {
  readonly tabs: readonly WorkspaceTab[];
  readonly activeTabId: string;
  readonly splitGroupTabIds: readonly string[];
  readonly focusedSplitTabId: string | null;
};

const DEFAULT_OPTIONS: WorkspaceTabsOptions = {
  splitOverflowPolicy: "block_with_notice"
};

const createTabId = (serial: number): string => `browser-tab-${serial}`;

const createSearchTab = (
  serial: number,
  config: WorkspaceTabsConfig
): WorkspaceTab => ({
  id: createTabId(serial),
  title: config.homeTabTitle,
  pageKind: "search",
  inputValue: "",
  displayAddress: config.homeSearchAddress,
  faviconUrl: undefined,
  query: undefined,
  searchMode: "standard",
  resultMode: "standard"
});

const createSettingsTab = (
  serial: number,
  config: WorkspaceTabsConfig
): WorkspaceTab => ({
  id: createTabId(serial),
  title: config.settingsTabTitle,
  pageKind: "settings",
  inputValue: "",
  displayAddress: SETTINGS_ADDRESS,
  faviconUrl: undefined,
  query: undefined,
  searchMode: "standard",
  resultMode: "standard"
});

const createTerminalTab = (
  serial: number,
  terminalTabId: string,
  title: string
): WorkspaceTab => ({
  id: createTabId(serial),
  title,
  pageKind: "terminal",
  inputValue: "",
  displayAddress: `lyra://terminal/${terminalTabId}`,
  faviconUrl: undefined,
  query: undefined,
  searchMode: "standard",
  resultMode: "standard",
  terminalTabId
});

const createAppTab = (
  serial: number,
  request: WorkspaceAppTabOpenRequest
): WorkspaceTab => ({
  id: createTabId(serial),
  title: request.title,
  pageKind: "app",
  inputValue: "",
  displayAddress: `lyra://app/${request.appId}/${request.appInstanceId}`,
  faviconUrl: undefined,
  query: undefined,
  searchMode: "standard",
  resultMode: "standard",
  appId: request.appId,
  appInstanceId: request.appInstanceId,
  appIconKey: request.iconKey,
  ...(request.filePath === undefined ? {} : { filePath: request.filePath }),
  ...(request.fileSessionId === undefined
    ? {}
    : { fileSessionId: request.fileSessionId }),
  ...(request.isDirty === undefined ? {} : { isDirty: request.isDirty })
});

const looksLikeUrl = (value: string): boolean => URL_OR_DOMAIN_PATTERN.test(value);

const normalizeUrl = (value: string): string => {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  return `https://${value}`;
};

const toPageTitle = (address: string): string => {
  try {
    const parsed = new URL(address);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    const title = `${parsed.hostname}${path}`;
    return title.length > 0 ? title : parsed.hostname;
  } catch (_error) {
    return address;
  }
};

const toSearchTitle = (query: string, maxLength: number): string => {
  const trimmed = query.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
};

const createPageTab = (
  serial: number,
  address: string,
  title?: string
): WorkspaceTab => ({
  id: createTabId(serial),
  title: title?.trim().length ? title.trim() : toPageTitle(address),
  pageKind: "page",
  inputValue: address,
  displayAddress: address,
  faviconUrl: undefined,
  query: undefined,
  searchMode: "standard",
  resultMode: "standard"
});

const toSafeAddress = (value: string): string | null => {
  const normalized = normalizeUrl(value.trim());
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch (_error) {
    return null;
  }
  return null;
};

const toNonEmptyTrimmed = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const clampTargetIndex = (targetIndex: number, maxExclusive: number): number => {
  if (Number.isFinite(targetIndex) === false) {
    return maxExclusive;
  }
  return Math.max(0, Math.min(maxExclusive, Math.trunc(targetIndex)));
};

const insertTabAt = (
  tabs: readonly WorkspaceTab[],
  tab: WorkspaceTab,
  targetIndex: number
): readonly WorkspaceTab[] => {
  const next = [...tabs];
  const insertIndex = clampTargetIndex(targetIndex, next.length);
  next.splice(insertIndex, 0, tab);
  return next;
};

const reorderTabsById = (
  tabs: readonly WorkspaceTab[],
  tabId: string,
  targetIndex: number
): readonly WorkspaceTab[] => {
  const fromIndex = tabs.findIndex((tab) => tab.id === tabId);
  if (fromIndex < 0) {
    return tabs;
  }
  const moving = tabs[fromIndex];
  if (moving === undefined) {
    return tabs;
  }
  const withoutMoving = tabs.filter((tab) => tab.id !== tabId);
  const insertIndex = clampTargetIndex(targetIndex, withoutMoving.length);
  const next = [...withoutMoving];
  next.splice(insertIndex, 0, moving);
  return next;
};

const reorderSplitGroupByTabId = (
  tabs: readonly WorkspaceTab[],
  splitGroupTabIds: readonly string[],
  tabId: string,
  targetIndex: number
): readonly WorkspaceTab[] => {
  const splitSet = new Set(splitGroupTabIds);
  if (splitSet.size < 2 || splitSet.has(tabId) === false) {
    return reorderTabsById(tabs, tabId, targetIndex);
  }

  const movingGroup = tabs.filter((tab) => splitSet.has(tab.id));
  if (movingGroup.length < 2) {
    return reorderTabsById(tabs, tabId, targetIndex);
  }

  const withoutGroup = tabs.filter((tab) => splitSet.has(tab.id) === false);
  const clampedTarget = clampTargetIndex(targetIndex, tabs.length);
  const nonSplitBeforeTarget = tabs
    .slice(0, clampedTarget)
    .filter((tab) => splitSet.has(tab.id) === false).length;
  const insertIndex = clampTargetIndex(nonSplitBeforeTarget, withoutGroup.length);
  const next = [...withoutGroup];
  next.splice(insertIndex, 0, ...movingGroup);
  return next;
};

const keepSplitGroupContiguous = (
  tabs: readonly WorkspaceTab[],
  splitGroupTabIds: readonly string[]
): readonly WorkspaceTab[] => {
  const splitSet = new Set(splitGroupTabIds);
  if (splitSet.size < 2) {
    return tabs;
  }

  const orderedSplitTabs = tabs.filter((tab) => splitSet.has(tab.id));
  if (orderedSplitTabs.length < 2) {
    return tabs;
  }

  const nonSplitTabs = tabs.filter((tab) => splitSet.has(tab.id) === false);
  const firstSplitIndex = tabs.findIndex((tab) => splitSet.has(tab.id));
  if (firstSplitIndex < 0) {
    return tabs;
  }

  const insertIndex = clampTargetIndex(firstSplitIndex, nonSplitTabs.length);
  const next = [...nonSplitTabs];
  next.splice(insertIndex, 0, ...orderedSplitTabs);
  return next;
};

const uniqueTabIds = (tabIds: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const tabId of tabIds) {
    if (seen.has(tabId)) {
      continue;
    }
    seen.add(tabId);
    next.push(tabId);
  }
  return next;
};

const resolveSplitState = (
  tabs: readonly WorkspaceTab[],
  splitGroupTabIds: readonly string[],
  focusedSplitTabId: string | null
): { readonly splitGroupTabIds: readonly string[]; readonly focusedSplitTabId: string | null } => {
  const validIds = new Set(tabs.map((tab) => tab.id));
  const nextGroup = uniqueTabIds(splitGroupTabIds).filter((tabId) => validIds.has(tabId));
  if (nextGroup.length <= 1) {
    return {
      splitGroupTabIds: [],
      focusedSplitTabId: null
    };
  }

  if (focusedSplitTabId !== null && nextGroup.includes(focusedSplitTabId)) {
    return {
      splitGroupTabIds: nextGroup,
      focusedSplitTabId
    };
  }

  return {
    splitGroupTabIds: nextGroup,
    focusedSplitTabId: nextGroup[0] ?? null
  };
};

const resolveRuntimeState = (
  state: WorkspaceTabsRuntimeState,
  config: WorkspaceTabsConfig
): WorkspaceTabsRuntimeState => {
  if (state.tabs.length === 0) {
    const fallback = createSearchTab(1, config);
    return {
      tabs: [fallback],
      activeTabId: fallback.id,
      splitGroupTabIds: [],
      focusedSplitTabId: null
    };
  }

  const split = resolveSplitState(
    state.tabs,
    state.splitGroupTabIds,
    state.focusedSplitTabId
  );
  const normalizedTabs = keepSplitGroupContiguous(state.tabs, split.splitGroupTabIds);
  const activeTabId = normalizedTabs.some((tab) => tab.id === state.activeTabId)
    ? state.activeTabId
    : normalizedTabs[0]!.id;

  return {
    tabs: normalizedTabs,
    activeTabId,
    splitGroupTabIds: split.splitGroupTabIds,
    focusedSplitTabId: split.focusedSplitTabId
  };
};

const createInitialRuntimeState = (config: WorkspaceTabsConfig): WorkspaceTabsRuntimeState => {
  const initialTab = createSearchTab(1, config);
  return {
    tabs: [initialTab],
    activeTabId: initialTab.id,
    splitGroupTabIds: [],
    focusedSplitTabId: null
  };
};

const toSnapshot = (state: WorkspaceTabsRuntimeState): WorkspaceTabsSessionSnapshot => ({
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

const isValidWorkspaceAppId = (
  value: string
): value is NonNullable<WorkspaceTab["appId"]> => VALID_WORKSPACE_APP_IDS.has(value as never);

const sanitizePersistedTab = (value: unknown): WorkspaceTab | null => {
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
  const appInstanceId = sanitizeOptionalString(value.appInstanceId);
  const appIconKey = sanitizeOptionalString(value.appIconKey);
  const filePath = sanitizeOptionalString(value.filePath);
  const fileSessionId = sanitizeOptionalString(value.fileSessionId);
  const isDirty = sanitizeOptionalBoolean(value.isDirty);

  if (pageKind === "terminal" && terminalTabId === undefined) {
    return null;
  }

  if (pageKind === "app" && (appId === undefined || appInstanceId === undefined)) {
    return null;
  }

  const sanitizedAppId =
    appId !== undefined && isValidWorkspaceAppId(appId) ? appId : undefined;

  if (pageKind === "app" && sanitizedAppId === undefined) {
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
    ...(sanitizedAppId === undefined ? {} : { appId: sanitizedAppId }),
    ...(appInstanceId === undefined ? {} : { appInstanceId }),
    ...(appIconKey === undefined
      ? {}
      : { appIconKey: appIconKey as NonNullable<WorkspaceTab["appIconKey"]> }),
    ...(filePath === undefined ? {} : { filePath }),
    ...(fileSessionId === undefined ? {} : { fileSessionId }),
    ...(isDirty === undefined ? {} : { isDirty })
  };
};

const sanitizePersistedSnapshot = (
  value: unknown,
  config: WorkspaceTabsConfig
): WorkspaceTabsRuntimeState | null => {
  if (isRecord(value) === false) {
    return null;
  }

  if (Array.isArray(value.tabs) === false || typeof value.activeTabId !== "string") {
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

const readPersistedState = (config: WorkspaceTabsConfig): WorkspaceTabsRuntimeState => {
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

const writePersistedState = (state: WorkspaceTabsRuntimeState): void => {
  if (typeof window === "undefined") {
    return;
  }
  writeWorkbenchStateSync(WORKBENCH_STATE_KEY, JSON.stringify(toSnapshot(state)));
};

const resolveNextSerial = (tabs: readonly WorkspaceTab[]): number => {
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

const applySplitOverflowPolicy = (
  candidateTabIds: readonly string[],
  sourceTabId: string,
  targetTabId: string,
  options: WorkspaceTabsOptions
): readonly string[] | null => {
  if (candidateTabIds.length <= MAX_SPLIT_TAB_COUNT) {
    return candidateTabIds;
  }

  if (options.splitOverflowPolicy === "block_with_notice") {
    return null;
  }

  if (options.splitOverflowPolicy === "replace_target") {
    const withoutTarget = candidateTabIds.filter((tabId) => tabId !== targetTabId);
    const preserved = withoutTarget.includes(sourceTabId)
      ? withoutTarget
      : [...withoutTarget, sourceTabId];

    while (preserved.length > MAX_SPLIT_TAB_COUNT) {
      preserved.shift();
    }
    return preserved;
  }

  const next = [...candidateTabIds];
  while (next.length > MAX_SPLIT_TAB_COUNT) {
    next.shift();
  }
  return next;
};

const composeSplitGroup = (
  currentGroup: readonly string[],
  sourceTabId: string,
  targetTabId: string,
  options: WorkspaceTabsOptions
): readonly string[] | null => {
  const group = [...uniqueTabIds(currentGroup)];
  const hasSource = group.includes(sourceTabId);
  const hasTarget = group.includes(targetTabId);

  let candidate: readonly string[];
  if (hasSource === false && hasTarget === false) {
    candidate = [targetTabId, sourceTabId];
  } else if (hasSource === false) {
    candidate = [...group, sourceTabId];
  } else if (hasTarget === false) {
    candidate = [...group, targetTabId];
  } else {
    candidate = group;
  }

  const deduped = uniqueTabIds(candidate);
  return applySplitOverflowPolicy(deduped, sourceTabId, targetTabId, options);
};

export const useWorkspaceTabsModel = (
  config: WorkspaceTabsConfig,
  options: WorkspaceTabsOptions = DEFAULT_OPTIONS
): WorkspaceTabsModel => {
  const nextTabSerialRef = useRef(2);
  const latestInputRef = useRef("");
  const [state, setState] = useState<WorkspaceTabsRuntimeState>(() => {
    const restored = readPersistedState(config);
    nextTabSerialRef.current = resolveNextSerial(restored.tabs);
    return restored;
  });

  useEffect(() => {
    nextTabSerialRef.current = resolveNextSerial(state.tabs);
  }, [state.tabs]);

  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0],
    [state.activeTabId, state.tabs]
  );

  useEffect(() => {
    latestInputRef.current = activeTab?.inputValue ?? "";
  }, [activeTab?.id, activeTab?.inputValue]);

  useEffect(() => {
    writePersistedState(state);
  }, [state]);

  useEffect(() => {
    setState((current) => {
      let hasChanges = false;
      const nextTabs = current.tabs.map((tab) => {
        if (tab.pageKind !== "settings") {
          return tab;
        }
        if (tab.title === config.settingsTabTitle) {
          return tab;
        }
        hasChanges = true;
        return {
          ...tab,
          title: config.settingsTabTitle
        };
      });

      if (hasChanges === false) {
        return current;
      }

      return {
        ...current,
        tabs: nextTabs
      };
    });
  }, [config.settingsTabTitle]);

  const patchTab = useCallback(
    (tabId: string, updater: (tab: WorkspaceTab) => WorkspaceTab): void => {
      setState((current) => ({
        ...current,
        tabs: current.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab))
      }));
    },
    []
  );

  const setActiveTab = useCallback((tabId: string): void => {
    const nextTabId = toNonEmptyTrimmed(tabId);
    if (nextTabId === null) {
      return;
    }

    setState((current) => {
      if (current.tabs.some((tab) => tab.id === nextTabId) === false) {
        return current;
      }

      return {
        ...current,
        activeTabId: nextTabId,
        focusedSplitTabId: current.splitGroupTabIds.includes(nextTabId)
          ? nextTabId
          : current.focusedSplitTabId
      };
    });
  }, []);

  const reorderTab = useCallback((tabId: string, targetIndex: number): void => {
    const nextTabId = toNonEmptyTrimmed(tabId);
    if (nextTabId === null) {
      return;
    }

    setState((current) => {
      const reordered = reorderSplitGroupByTabId(
        current.tabs,
        current.splitGroupTabIds,
        nextTabId,
        targetIndex
      );
      return {
        ...current,
        tabs: keepSplitGroupContiguous(reordered, current.splitGroupTabIds)
      };
    });
  }, []);

  const splitTabWithTarget = useCallback((sourceTabId: string, targetTabId: string): void => {
    const source = toNonEmptyTrimmed(sourceTabId);
    const target = toNonEmptyTrimmed(targetTabId);
    if (source === null || target === null || source === target) {
      return;
    }

    setState((current) => {
      if (current.tabs.some((tab) => tab.id === source) === false) {
        return current;
      }
      if (current.tabs.some((tab) => tab.id === target) === false) {
        return current;
      }

      const candidate = composeSplitGroup(current.splitGroupTabIds, source, target, options);
      if (candidate === null || candidate.length < 2) {
        return current;
      }

      return {
        ...current,
        activeTabId: source,
        splitGroupTabIds: candidate,
        focusedSplitTabId: source
      };
    });
  }, [options]);

  const detachTabFromSplit = useCallback((tabId: string): void => {
    const nextTabId = toNonEmptyTrimmed(tabId);
    if (nextTabId === null) {
      return;
    }

    setState((current) => {
      if (current.splitGroupTabIds.includes(nextTabId) === false) {
        return current;
      }

      const remaining = current.splitGroupTabIds.filter((candidate) => candidate !== nextTabId);
      if (remaining.length <= 1) {
        return {
          ...current,
          activeTabId: nextTabId,
          splitGroupTabIds: [],
          focusedSplitTabId: null
        };
      }

      return {
        ...current,
        activeTabId: nextTabId,
        splitGroupTabIds: remaining,
        focusedSplitTabId: remaining[0] ?? null
      };
    });
  }, []);

  const openNewTab = useCallback((): void => {
    const serial = nextTabSerialRef.current;
    const nextTab = createSearchTab(serial, config);
    nextTabSerialRef.current += 1;

    setState((current) => ({
      ...current,
      tabs: [...current.tabs, nextTab],
      activeTabId: nextTab.id
    }));
  }, [config]);

  const openSettingsTab = useCallback((): void => {
    setState((current) => {
      const existing = current.tabs.find((tab) => tab.pageKind === "settings");
      if (existing !== undefined) {
        return {
          ...current,
          activeTabId: existing.id,
          focusedSplitTabId: current.splitGroupTabIds.includes(existing.id)
            ? existing.id
            : current.focusedSplitTabId
        };
      }

      const serial = nextTabSerialRef.current;
      const nextTab = createSettingsTab(serial, config);
      nextTabSerialRef.current += 1;
      return {
        ...current,
        tabs: [...current.tabs, nextTab],
        activeTabId: nextTab.id
      };
    });
  }, [config]);

  const openTerminalTab = useCallback((
    terminalTabId: string,
    title: string,
    options?: WorkspaceTabInsertOptions
  ): void => {
    const trimmedId = toNonEmptyTrimmed(terminalTabId);
    if (trimmedId === null) {
      return;
    }
    const nextTitle = toNonEmptyTrimmed(title) ?? FALLBACK_TERMINAL_TITLE;
    const requestedTargetIndex = options?.targetIndex;

    setState((current) => {
      const existing = current.tabs.find(
        (tab) => tab.pageKind === "terminal" && tab.terminalTabId === trimmedId
      );
      if (existing !== undefined) {
        const nextTabs =
          requestedTargetIndex === undefined
            ? current.tabs
            : reorderTabsById(current.tabs, existing.id, requestedTargetIndex);
        const normalizedTabs = keepSplitGroupContiguous(
          nextTabs,
          current.splitGroupTabIds
        );

        return {
          ...current,
          tabs: normalizedTabs,
          activeTabId: existing.id,
          focusedSplitTabId: current.splitGroupTabIds.includes(existing.id)
            ? existing.id
            : current.focusedSplitTabId
        };
      }

      const serial = nextTabSerialRef.current;
      const nextTab = createTerminalTab(serial, trimmedId, nextTitle);
      nextTabSerialRef.current += 1;

      return {
        ...current,
        tabs: keepSplitGroupContiguous(
          requestedTargetIndex === undefined
            ? [...current.tabs, nextTab]
            : insertTabAt(current.tabs, nextTab, requestedTargetIndex),
          current.splitGroupTabIds
        ),
        activeTabId: nextTab.id
      };
    });
  }, []);

  const openAppTab = useCallback((request: WorkspaceAppTabOpenRequest): void => {
    setState((current) => {
      const existing = current.tabs.find(
        (tab) =>
          tab.pageKind === "app" &&
          tab.appId === request.appId &&
          tab.appInstanceId === request.appInstanceId
      );
      if (existing !== undefined) {
        return {
          ...current,
          activeTabId: existing.id,
          focusedSplitTabId: current.splitGroupTabIds.includes(existing.id)
            ? existing.id
            : current.focusedSplitTabId
        };
      }

      const serial = nextTabSerialRef.current;
      const nextTab = createAppTab(serial, request);
      nextTabSerialRef.current += 1;
      return {
        ...current,
        tabs: [...current.tabs, nextTab],
        activeTabId: nextTab.id
      };
    });
  }, []);

  const updateAppTabMeta = useCallback((request: WorkspaceAppTabMetaRequest): void => {
    setState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => {
        if (
          tab.pageKind !== "app" ||
          tab.appId !== request.appId ||
          tab.appInstanceId !== request.appInstanceId
        ) {
          return tab;
        }

        if (tab.title === request.title && tab.appIconKey === request.iconKey) {
          return tab;
        }

        return {
          ...tab,
          title: request.title,
          appIconKey: request.iconKey,
          ...(request.filePath === undefined ? {} : { filePath: request.filePath }),
          ...(request.fileSessionId === undefined
            ? {}
            : { fileSessionId: request.fileSessionId }),
          ...(request.isDirty === undefined ? {} : { isDirty: request.isDirty })
        };
      })
    }));
  }, []);

  const closeTab = useCallback((tabId: string): void => {
    const nextTabId = toNonEmptyTrimmed(tabId);
    if (nextTabId === null) {
      return;
    }

    setState((current) => {
      if (current.tabs.length <= 1) {
        return current;
      }

      const removeIndex = current.tabs.findIndex((tab) => tab.id === nextTabId);
      if (removeIndex < 0) {
        return current;
      }

      const nextTabs = current.tabs.filter((tab) => tab.id !== nextTabId);
      const nextActiveTabId =
        nextTabId === current.activeTabId
          ? (nextTabs[removeIndex > 0 ? removeIndex - 1 : 0]?.id ?? nextTabs[0]!.id)
          : current.activeTabId;

      const split = resolveSplitState(
        nextTabs,
        current.splitGroupTabIds.filter((tabIdInSplit) => tabIdInSplit !== nextTabId),
        current.focusedSplitTabId === nextTabId
          ? null
          : current.focusedSplitTabId
      );

      return resolveRuntimeState(
        {
          tabs: nextTabs,
          activeTabId: nextActiveTabId,
          splitGroupTabIds: split.splitGroupTabIds,
          focusedSplitTabId: split.splitGroupTabIds.includes(nextActiveTabId)
            ? nextActiveTabId
            : split.focusedSplitTabId
        },
        config
      );
    });
  }, [config]);

  const closeTerminalTab = useCallback((terminalTabId: string): void => {
    const trimmedId = toNonEmptyTrimmed(terminalTabId);
    if (trimmedId === null) {
      return;
    }

    setState((current) => {
      const target = current.tabs.find(
        (tab) => tab.pageKind === "terminal" && tab.terminalTabId === trimmedId
      );
      if (target === undefined) {
        return current;
      }

      if (current.tabs.length === 1) {
        const serial = nextTabSerialRef.current;
        const fallback = createSearchTab(serial, config);
        nextTabSerialRef.current += 1;
        return {
          tabs: [fallback],
          activeTabId: fallback.id,
          splitGroupTabIds: [],
          focusedSplitTabId: null
        };
      }

      const removeIndex = current.tabs.findIndex((tab) => tab.id === target.id);
      const nextTabs = current.tabs.filter((tab) => tab.id !== target.id);
      const nextActiveTabId =
        target.id === current.activeTabId
          ? (nextTabs[removeIndex > 0 ? removeIndex - 1 : 0]?.id ?? nextTabs[0]!.id)
          : current.activeTabId;

      const split = resolveSplitState(
        nextTabs,
        current.splitGroupTabIds.filter((tabIdInSplit) => tabIdInSplit !== target.id),
        current.focusedSplitTabId === target.id
          ? null
          : current.focusedSplitTabId
      );

      return resolveRuntimeState(
        {
          tabs: nextTabs,
          activeTabId: nextActiveTabId,
          splitGroupTabIds: split.splitGroupTabIds,
          focusedSplitTabId: split.splitGroupTabIds.includes(nextActiveTabId)
            ? nextActiveTabId
            : split.focusedSplitTabId
        },
        config
      );
    });
  }, [config]);

  const openPageInNewTab = useCallback((address: string, title?: string): void => {
    const normalizedAddress = toSafeAddress(address);
    if (normalizedAddress === null) {
      return;
    }

    const serial = nextTabSerialRef.current;
    const nextTab = createPageTab(serial, normalizedAddress, title);
    nextTabSerialRef.current += 1;

    setState((current) => ({
      ...current,
      tabs: [...current.tabs, nextTab],
      activeTabId: nextTab.id
    }));
    latestInputRef.current = normalizedAddress;
  }, []);

  const updatePageMeta = useCallback(
    (tabId: string, meta: WorkspaceTabPageMeta): void => {
      if (toNonEmptyTrimmed(tabId) === null) {
        return;
      }
      const nextTitle = meta.title?.trim();
      const nextFaviconUrl = meta.faviconUrl?.trim();

      if (
        (nextTitle === undefined || nextTitle.length === 0) &&
        (nextFaviconUrl === undefined || nextFaviconUrl.length === 0)
      ) {
        return;
      }

      patchTab(tabId, (tab) => {
        if (tab.pageKind !== "page") {
          return tab;
        }

        return {
          ...tab,
          ...(nextTitle !== undefined && nextTitle.length > 0
            ? { title: nextTitle }
            : {}),
          ...(nextFaviconUrl !== undefined && nextFaviconUrl.length > 0
            ? { faviconUrl: nextFaviconUrl }
            : {})
        };
      });
    },
    [patchTab]
  );

  const syncPageRuntimeState = useCallback(
    (tabId: string, state: WorkspaceTabPageRuntimeState): void => {
      if (toNonEmptyTrimmed(tabId) === null) {
        return;
      }
      const nextAddress = toSafeAddress(state.address);
      const nextTitle = toNonEmptyTrimmed(state.title);
      const nextFaviconUrl = state.faviconUrl?.trim();
      if (nextAddress === null || nextTitle === null) {
        return;
      }

      patchTab(tabId, (tab) => {
        if (tab.pageKind !== "page") {
          return tab;
        }

        const nextFaviconValue =
          nextFaviconUrl === undefined || nextFaviconUrl.length === 0
            ? undefined
            : nextFaviconUrl;
        if (
          tab.title === nextTitle
          && tab.displayAddress === nextAddress
          && tab.inputValue === nextAddress
          && tab.faviconUrl === nextFaviconValue
        ) {
          return tab;
        }

        return {
          ...tab,
          title: nextTitle,
          displayAddress: nextAddress,
          inputValue: nextAddress,
          ...(nextFaviconValue === undefined
            ? {}
            : { faviconUrl: nextFaviconValue })
        };
      });
    },
    [patchTab]
  );

  const updateActiveInput = useCallback((value: string): void => {
    latestInputRef.current = value;
    if (activeTab === undefined) {
      return;
    }
    patchTab(activeTab.id, (tab) => ({
      ...tab,
      inputValue: value
    }));
  }, [activeTab, patchTab]);

  const setActiveSearchMode = useCallback((mode: WorkspaceSearchMode): void => {
    if (activeTab === undefined) {
      return;
    }
    patchTab(activeTab.id, (tab) => ({
      ...tab,
      searchMode: mode
    }));
  }, [activeTab, patchTab]);

  const commitActiveInput = useCallback((): void => {
    const current = activeTab;
    if (current === undefined) {
      return;
    }

    const nextInput = latestInputRef.current.trim();
    if (nextInput.length === 0) {
      if (current.pageKind !== "search") {
        patchTab(current.id, (tab) => ({
          ...tab,
          pageKind: "search",
          title: config.homeTabTitle,
          displayAddress: config.homeSearchAddress,
          inputValue: "",
          query: undefined,
          faviconUrl: undefined,
          resultMode: tab.searchMode ?? tab.resultMode ?? "standard"
        }));
      }
      return;
    }

    if (looksLikeUrl(nextInput)) {
      const safeAddress = toSafeAddress(nextInput);
      if (safeAddress === null) {
        return;
      }
      patchTab(current.id, (tab) => ({
        ...tab,
        pageKind: "page",
        title: toPageTitle(safeAddress),
        displayAddress: safeAddress,
        inputValue: safeAddress,
        query: undefined,
        faviconUrl: undefined,
        resultMode: tab.resultMode ?? tab.searchMode ?? "standard"
      }));
      latestInputRef.current = safeAddress;
      return;
    }

    patchTab(current.id, (tab) => ({
      ...tab,
      pageKind: "results",
      title: toSearchTitle(nextInput, config.maxSearchTitleLength),
      displayAddress: `${config.homeSearchAddress}?q=${encodeURIComponent(nextInput)}`,
      inputValue: nextInput,
      query: nextInput,
      faviconUrl: undefined,
      resultMode: tab.searchMode ?? "standard"
    }));
  }, [activeTab, config.homeSearchAddress, config.homeTabTitle, config.maxSearchTitleLength, patchTab]);

  const isTabInSplit = useCallback(
    (tabId: string): boolean => state.splitGroupTabIds.includes(tabId),
    [state.splitGroupTabIds]
  );

  const getVisibleWorkspaceLayout = useCallback(() => {
    const activeId = state.activeTabId;
    const splitGroup = resolveSplitState(
      state.tabs,
      state.splitGroupTabIds,
      state.focusedSplitTabId
    );

    if (
      splitGroup.splitGroupTabIds.length >= 2 &&
      splitGroup.splitGroupTabIds.includes(activeId)
    ) {
      return {
        mode: "split" as const,
        activeTabId: activeId,
        visibleTabIds: splitGroup.splitGroupTabIds,
        splitGroupTabIds: splitGroup.splitGroupTabIds,
        focusedSplitTabId: splitGroup.focusedSplitTabId ?? splitGroup.splitGroupTabIds[0]!
      };
    }

    return {
      mode: "single" as const,
      activeTabId: activeId,
      visibleTabIds: [activeId],
      splitGroupTabIds: splitGroup.splitGroupTabIds,
      focusedSplitTabId: splitGroup.focusedSplitTabId
    };
  }, [state.activeTabId, state.focusedSplitTabId, state.splitGroupTabIds, state.tabs]);

  const snapshotWorkspaceSession = useCallback(
    (): WorkspaceTabsSessionSnapshot => toSnapshot(state),
    [state]
  );

  const restoreWorkspaceSession = useCallback((snapshot: WorkspaceTabsSessionSnapshot): void => {
    const restored = sanitizePersistedSnapshot(snapshot, config);
    if (restored === null) {
      return;
    }
    nextTabSerialRef.current = resolveNextSerial(restored.tabs);
    setState(restored);
    const nextActive = restored.tabs.find((tab) => tab.id === restored.activeTabId);
    latestInputRef.current = nextActive?.inputValue ?? "";
  }, [config]);

  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activeTab,
    splitGroupTabIds: state.splitGroupTabIds,
    focusedSplitTabId: state.focusedSplitTabId,
    setActiveTab,
    reorderTab,
    splitTabWithTarget,
    detachTabFromSplit,
    isTabInSplit,
    getVisibleWorkspaceLayout,
    snapshotWorkspaceSession,
    restoreWorkspaceSession,
    openNewTab,
    openSettingsTab,
    openTerminalTab,
    openAppTab,
    updateAppTabMeta,
    closeTerminalTab,
    openPageInNewTab,
    closeTab,
    updatePageMeta,
    syncPageRuntimeState,
    updateActiveInput,
    setActiveSearchMode,
    commitActiveInput
  };
};
