import { useMemo, useState } from "react";

import type {
  TerminalCreateRequest,
  TerminalSessionSnapshot
} from "../../../shared/desktop-bridge";
import { readWorkbenchStateSync, writeWorkbenchStateSync } from "../state-storage";
import type {
  TerminalDockModel,
  TerminalDockPane,
  TerminalDockState,
  TerminalDockTab,
  TerminalTabPlacement,
  TerminalSplitDirection
} from "./types";

const WORKBENCH_STATE_KEY = "terminal-dock" as const;
const RESTORE_COLS = 80;
const RESTORE_ROWS = 24;

const createId = (prefix: string): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
};

type CreateTerminalTabOptions = {
  readonly placement?: TerminalTabPlacement;
  readonly title?: string;
  readonly cwd?: string;
};

const normalizeTitle = (value: string | undefined, fallback: string): string => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
};

const createPane = (index: number, options?: CreateTerminalTabOptions): TerminalDockPane => {
  const paneId = createId("pane");
  const title = normalizeTitle(options?.title, `Terminal ${index}`);
  return {
    id: paneId,
    sessionId: `session-${paneId}`,
    title,
    ...(options?.cwd !== undefined && options.cwd.trim().length > 0
      ? { cwd: options.cwd.trim() }
      : {})
  };
};

const createTab = (
  index: number,
  options?: CreateTerminalTabOptions
): {
  readonly tab: TerminalDockTab;
  readonly pane: TerminalDockPane;
} => {
  const pane = createPane(index, options);
  const title = normalizeTitle(options?.title, pane.title);
  return {
    tab: {
      id: createId("tab"),
      title,
      orientation: "horizontal",
      paneIds: [pane.id],
      activePaneId: pane.id,
      placement: options?.placement ?? "dock"
    },
    pane
  };
};

const findTabById = (state: TerminalDockState, tabId: string): TerminalDockTab | null =>
  state.tabs.find((tab) => tab.id === tabId) ?? null;

const getDockTabs = (state: TerminalDockState): readonly TerminalDockTab[] =>
  state.tabs.filter((tab) => tab.placement === "dock");

const getWorkspaceTabs = (state: TerminalDockState): readonly TerminalDockTab[] =>
  state.tabs.filter((tab) => tab.placement === "workspace");

const findActiveDockTab = (state: TerminalDockState): TerminalDockTab | null => {
  const exact = state.tabs.find((tab) => tab.id === state.activeTabId && tab.placement === "dock");
  if (exact !== undefined) {
    return exact;
  }
  return getDockTabs(state)[0] ?? null;
};

const withTabUpdate = (
  state: TerminalDockState,
  tabId: string,
  updater: (tab: TerminalDockTab) => TerminalDockTab
): TerminalDockState => ({
  ...state,
  tabs: state.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab))
});

const clampTargetIndex = (targetIndex: number, maxExclusive: number): number => {
  if (Number.isFinite(targetIndex) === false) {
    return maxExclusive;
  }
  return Math.max(0, Math.min(maxExclusive, Math.trunc(targetIndex)));
};

const resolveNextActiveTabId = (
  currentTabs: readonly TerminalDockTab[],
  removeTabId: string,
  activeTabId: string
): string => {
  if (currentTabs.length === 0) {
    return "";
  }
  if (removeTabId !== activeTabId) {
    return activeTabId;
  }
  const removedIndex = currentTabs.findIndex((tab) => tab.id === removeTabId);
  const fallbackIndex = removedIndex > 0 ? removedIndex - 1 : 0;
  return currentTabs[fallbackIndex]?.id ?? currentTabs[0]!.id;
};

const sanitizePane = (value: unknown): TerminalDockPane | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId.trim() : "";
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (id.length === 0 || sessionId.length === 0 || title.length === 0) {
    return null;
  }
  const cwd = typeof raw.cwd === "string" && raw.cwd.trim().length > 0 ? raw.cwd.trim() : undefined;
  return {
    id,
    sessionId,
    title,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(raw.mode === "command" || raw.mode === "shell" ? { mode: raw.mode } : {}),
    ...(typeof raw.command === "string" && raw.command.trim().length > 0
      ? { command: raw.command.trim() }
      : {})
  };
};

const sanitizeTab = (value: unknown): TerminalDockTab | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const activePaneId = typeof raw.activePaneId === "string" ? raw.activePaneId.trim() : "";
  const paneIds = Array.isArray(raw.paneIds)
    ? raw.paneIds
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];
  const orientation = raw.orientation === "vertical" ? "vertical" : "horizontal";
  const placement = raw.placement === "workspace" ? "workspace" : "dock";

  if (id.length === 0 || title.length === 0 || activePaneId.length === 0 || paneIds.length === 0) {
    return null;
  }
  if (paneIds.includes(activePaneId) === false) {
    return null;
  }
  return {
    id,
    title,
    orientation,
    paneIds,
    activePaneId,
    placement
  };
};

const parsePersistedState = (raw: string): TerminalDockState | null => {
  try {
    const parsed = JSON.parse(raw) as {
      readonly tabs?: unknown;
      readonly panes?: unknown;
      readonly activeTabId?: unknown;
    };

    if (!Array.isArray(parsed.tabs) || typeof parsed.activeTabId !== "string") {
      return null;
    }

    if (parsed.panes === undefined || parsed.panes === null || typeof parsed.panes !== "object") {
      return null;
    }

    const panesRecord = parsed.panes as Record<string, unknown>;
    const panes: Record<string, TerminalDockPane> = {};
    for (const [paneId, paneValue] of Object.entries(panesRecord)) {
      const pane = sanitizePane(paneValue);
      if (pane === null) {
        continue;
      }
      panes[paneId] = pane;
    }

    const tabs = parsed.tabs.map((entry) => sanitizeTab(entry)).filter((entry): entry is TerminalDockTab => entry !== null);
    if (tabs.length === 0 || Object.keys(panes).length === 0) {
      return null;
    }

    const validTabs = tabs.filter((tab) => tab.paneIds.every((paneId) => panes[paneId] !== undefined));
    if (validTabs.length === 0) {
      return null;
    }

    const activeTabId = validTabs.some((tab) => tab.id === parsed.activeTabId)
      ? parsed.activeTabId
      : validTabs[0]!.id;

    return {
      tabs: validTabs,
      panes,
      activeTabId
    };
  } catch (_error) {
    return null;
  }
};

const readPersistedState = (): TerminalDockState => {
  if (typeof window === "undefined") {
    return createDefaultTerminalDockState();
  }

  const raw = readWorkbenchStateSync(WORKBENCH_STATE_KEY);
  if (raw === null) {
    return createDefaultTerminalDockState();
  }

  return parsePersistedState(raw) ?? createDefaultTerminalDockState();
};

const persistState = (state: TerminalDockState): void => {
  if (typeof window === "undefined") {
    return;
  }
  writeWorkbenchStateSync(WORKBENCH_STATE_KEY, JSON.stringify(state));
};

export const createDefaultTerminalDockState = (): TerminalDockState => {
  const { tab, pane } = createTab(1);
  return {
    tabs: [tab],
    panes: {
      [pane.id]: pane
    },
    activeTabId: tab.id
  };
};

export const openTerminalTabState = (state: TerminalDockState): TerminalDockState => {
  const index = state.tabs.length + 1;
  const { tab, pane } = createTab(index);
  return {
    ...state,
    tabs: [...state.tabs, tab],
    panes: {
      ...state.panes,
      [pane.id]: pane
    },
    activeTabId: tab.id
  };
};

export const openTerminalTabWithPlacementState = (
  state: TerminalDockState,
  options?: CreateTerminalTabOptions
): {
  readonly state: TerminalDockState;
  readonly tab: TerminalDockTab;
  readonly pane: TerminalDockPane;
} => {
  const index = state.tabs.length + 1;
  const { tab, pane } = createTab(index, options);
  return {
    tab,
    pane,
    state: {
      ...state,
      tabs: [...state.tabs, tab],
      panes: {
        ...state.panes,
        [pane.id]: pane
      },
      activeTabId: tab.id
    }
  };
};

export const closeTerminalTabState = (state: TerminalDockState, tabId: string): TerminalDockState => {
  const tab = findTabById(state, tabId);
  if (tab === null) {
    return state;
  }

  const nextTabs = state.tabs.filter((item) => item.id !== tabId);
  const nextPanes = { ...state.panes };
  for (const paneId of tab.paneIds) {
    delete nextPanes[paneId];
  }

  const activeTabId = resolveNextActiveTabId(nextTabs, tabId, state.activeTabId);

  return {
    ...state,
    tabs: nextTabs,
    panes: nextPanes,
    activeTabId
  };
};

export const moveTerminalTabToWorkspaceState = (state: TerminalDockState, tabId: string): TerminalDockState => {
  const tab = findTabById(state, tabId);
  if (tab === null || tab.placement === "workspace") {
    return state;
  }

  const nextState = withTabUpdate(state, tabId, (item) => ({
    ...item,
    placement: "workspace"
  }));

  if (state.activeTabId !== tabId) {
    return nextState;
  }

  const nextDockTab = getDockTabs(nextState)[0];
  if (nextDockTab !== undefined) {
    return {
      ...nextState,
      activeTabId: nextDockTab.id
    };
  }

  return nextState;
};

export const moveTerminalTabToDockState = (state: TerminalDockState, tabId: string): TerminalDockState => {
  const tab = findTabById(state, tabId);
  if (tab === null || tab.placement === "dock") {
    return state;
  }

  return {
    ...withTabUpdate(state, tabId, (item) => ({
      ...item,
      placement: "dock"
    })),
    activeTabId: tabId
  };
};

export const reorderDockTerminalTabState = (
  state: TerminalDockState,
  tabId: string,
  targetIndex: number
): TerminalDockState => {
  const targetTab = findTabById(state, tabId);
  if (targetTab === null || targetTab.placement !== "dock") {
    return state;
  }

  const remainingTabs = state.tabs.filter((tab) => tab.id !== tabId);
  const dockTabsWithoutMoving = remainingTabs.filter((tab) => tab.placement === "dock");
  const normalizedDockIndex = clampTargetIndex(targetIndex, dockTabsWithoutMoving.length);

  const insertionGlobalIndex =
    normalizedDockIndex >= dockTabsWithoutMoving.length
      ? (() => {
          const lastDockGlobalIndex = remainingTabs.reduce((acc, tab, index) => {
            if (tab.placement === "dock") {
              return index;
            }
            return acc;
          }, -1);
          return lastDockGlobalIndex >= 0 ? lastDockGlobalIndex + 1 : 0;
        })()
      : (() => {
          const anchorTab = dockTabsWithoutMoving[normalizedDockIndex];
          if (anchorTab === undefined) {
            return remainingTabs.length;
          }
          const anchorIndex = remainingTabs.findIndex((tab) => tab.id === anchorTab.id);
          return anchorIndex >= 0 ? anchorIndex : remainingTabs.length;
        })();

  const nextTabs = [...remainingTabs];
  nextTabs.splice(insertionGlobalIndex, 0, targetTab);

  return {
    ...state,
    tabs: nextTabs
  };
};

export const splitTerminalTabState = (
  state: TerminalDockState,
  tabId: string,
  direction: TerminalSplitDirection
): TerminalDockState => {
  const tab = findTabById(state, tabId);
  if (tab === null) {
    return state;
  }

  const pane = createPane(Object.keys(state.panes).length + 1);
  const activePaneIndex = tab.paneIds.findIndex((paneId) => paneId === tab.activePaneId);
  const insertIndex = activePaneIndex < 0 ? tab.paneIds.length : activePaneIndex + 1;
  const nextPaneIds = [...tab.paneIds];
  nextPaneIds.splice(insertIndex, 0, pane.id);

  return {
    ...withTabUpdate(state, tab.id, (item) => ({
      ...item,
      orientation: direction,
      paneIds: nextPaneIds,
      activePaneId: pane.id
    })),
    panes: {
      ...state.panes,
      [pane.id]: pane
    }
  };
};

export const splitActivePaneState = (
  state: TerminalDockState,
  direction: TerminalSplitDirection
): TerminalDockState => {
  const activeDockTab = findActiveDockTab(state);
  if (activeDockTab === null) {
    return state;
  }
  return splitTerminalTabState(state, activeDockTab.id, direction);
};

export const focusTerminalPaneForTabState = (
  state: TerminalDockState,
  tabId: string,
  paneId: string
): TerminalDockState => {
  const tab = findTabById(state, tabId);
  if (tab === null || tab.paneIds.includes(paneId) === false) {
    return state;
  }

  return {
    ...withTabUpdate(state, tabId, (item) => ({
      ...item,
      activePaneId: paneId
    })),
    activeTabId: tabId
  };
};

export const focusTerminalPaneState = (state: TerminalDockState, paneId: string): TerminalDockState => {
  const activeDockTab = findActiveDockTab(state);
  if (activeDockTab === null) {
    return state;
  }
  return focusTerminalPaneForTabState(state, activeDockTab.id, paneId);
};

export const closeTerminalPaneForTabState = (
  state: TerminalDockState,
  tabId: string,
  paneId: string
): TerminalDockState => {
  const tab = findTabById(state, tabId);
  if (tab === null || tab.paneIds.includes(paneId) === false) {
    return state;
  }

  if (tab.paneIds.length === 1) {
    return closeTerminalTabState(state, tabId);
  }

  const nextPaneIds = tab.paneIds.filter((id) => id !== paneId);
  const nextActivePaneId = tab.activePaneId === paneId ? nextPaneIds[Math.max(0, nextPaneIds.length - 1)]! : tab.activePaneId;
  const nextState = withTabUpdate(state, tabId, (item) => ({
    ...item,
    paneIds: nextPaneIds,
    activePaneId: nextActivePaneId
  }));

  const nextPanes = { ...nextState.panes };
  delete nextPanes[paneId];

  return {
    ...nextState,
    panes: nextPanes
  };
};

export const closeTerminalPaneState = (state: TerminalDockState, paneId: string): TerminalDockState => {
  const activeDockTab = findActiveDockTab(state);
  if (activeDockTab === null) {
    return state;
  }
  return closeTerminalPaneForTabState(state, activeDockTab.id, paneId);
};

export const syncTerminalSnapshotsState = (
  state: TerminalDockState,
  snapshots: readonly TerminalSessionSnapshot[]
): TerminalDockState => {
  if (snapshots.length === 0) {
    return state;
  }

  const bySession = new Map(snapshots.map((snapshot) => [snapshot.sessionId, snapshot]));
  const nextPanes: Record<string, TerminalDockPane> = { ...state.panes };

  for (const pane of Object.values(state.panes)) {
    const snapshot = bySession.get(pane.sessionId);
    if (snapshot === undefined) {
      continue;
    }

    nextPanes[pane.id] = {
      ...pane,
      title: snapshot.title,
      ...(snapshot.cwd !== undefined ? { cwd: snapshot.cwd } : {})
    };
  }

  return {
    ...state,
    panes: nextPanes
  };
};

const toRestoreRequest = (state: TerminalDockState): { readonly sessions: readonly TerminalCreateRequest[] } => {
  const sessions = Object.values(state.panes).map((pane) => ({
    sessionId: pane.sessionId,
    title: pane.title,
    ...(pane.cwd !== undefined ? { cwd: pane.cwd } : {}),
    cols: RESTORE_COLS,
    rows: RESTORE_ROWS,
    source: "user" as const
  }));

  return {
    sessions
  };
};

export const useTerminalDockModel = (): TerminalDockModel => {
  const [state, setState] = useState<TerminalDockState>(() => readPersistedState());

  const dockTabs = useMemo(() => getDockTabs(state), [state]);
  const workspaceTabs = useMemo(() => getWorkspaceTabs(state), [state]);
  const activeDockTab = useMemo(() => findActiveDockTab(state), [state]);
  const activeDockPanes = useMemo(() => {
    if (activeDockTab === null) {
      return [];
    }
    return activeDockTab.paneIds
      .map((paneId) => state.panes[paneId])
      .filter((pane): pane is TerminalDockPane => pane !== undefined);
  }, [activeDockTab, state.panes]);
  const restoreRequest = useMemo(() => toRestoreRequest(state), [state]);

  const commit = (updater: (current: TerminalDockState) => TerminalDockState): void => {
    setState((current) => {
      const next = updater(current);
      persistState(next);
      return next;
    });
  };

  return {
    state,
    dockTabs,
    workspaceTabs,
    activeDockTab,
    activeDockPanes,
    restoreRequest,
    findTab: (tabId: string) => findTabById(state, tabId),
    getTabPanes: (tabId: string) => {
      const tab = findTabById(state, tabId);
      if (tab === null) {
        return [];
      }
      return tab.paneIds
        .map((paneId) => state.panes[paneId])
        .filter((pane): pane is TerminalDockPane => pane !== undefined);
    },
    setActiveTab: (tabId: string) => {
      commit((current) => {
        if (current.tabs.some((tab) => tab.id === tabId) === false) {
          return current;
        }
        return {
          ...current,
          activeTabId: tabId
        };
      });
    },
    openTab: () => {
      commit((current) => openTerminalTabState(current));
    },
    openTabWithPlacement: (request) => {
      const result = openTerminalTabWithPlacementState(state, request);
      persistState(result.state);
      setState(result.state);
      return {
        tab: result.tab,
        pane: result.pane
      };
    },
    closeTab: (tabId: string) => {
      commit((current) => closeTerminalTabState(current, tabId));
    },
    moveTabToWorkspace: (tabId: string) => {
      commit((current) => moveTerminalTabToWorkspaceState(current, tabId));
    },
    moveTabToDock: (tabId: string) => {
      commit((current) => moveTerminalTabToDockState(current, tabId));
    },
    reorderDockTab: (tabId: string, targetIndex: number) => {
      commit((current) => reorderDockTerminalTabState(current, tabId, targetIndex));
    },
    splitActivePane: (direction: TerminalSplitDirection) => {
      commit((current) => splitActivePaneState(current, direction));
    },
    splitTab: (tabId: string, direction: TerminalSplitDirection) => {
      commit((current) => splitTerminalTabState(current, tabId, direction));
    },
    focusPane: (tabId: string, paneId: string) => {
      commit((current) => focusTerminalPaneForTabState(current, tabId, paneId));
    },
    closePane: (tabId: string, paneId: string) => {
      commit((current) => closeTerminalPaneForTabState(current, tabId, paneId));
    },
    syncRestoredSessions: (snapshots: readonly TerminalSessionSnapshot[]) => {
      commit((current) => syncTerminalSnapshotsState(current, snapshots));
    }
  };
};
