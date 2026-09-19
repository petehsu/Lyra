import { useSyncExternalStore } from "react";

export type DockProblemsTab = {
  readonly id: string;
  readonly instanceId: string;
  readonly title: string;
  readonly rootPath: string;
};

export type DockProblemsState = {
  readonly tabs: readonly DockProblemsTab[];
  readonly activeId: string | null;
};

export type DockProblemsOpenRequest = {
  readonly instanceId: string;
  readonly title: string;
  readonly rootPath: string;
};

export const dockProblemsTabId = (instanceId: string): string => `problems:${instanceId}`;

let state: DockProblemsState = {
  tabs: [],
  activeId: null
};
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

export const getDockProblemsState = (): DockProblemsState => state;

export const subscribeDockProblems = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const openDockProblemsTab = (request: DockProblemsOpenRequest): void => {
  const id = dockProblemsTabId(request.instanceId);
  const tab: DockProblemsTab = {
    id,
    instanceId: request.instanceId,
    title: request.title,
    rootPath: request.rootPath
  };
  const existing = state.tabs.find((item) => item.id === id);
  state = {
    tabs: existing === undefined
      ? [...state.tabs, tab]
      : state.tabs.map((item) => item.id === id ? tab : item),
    activeId: id
  };
  emit();
};

export const closeDockProblemsTab = (tabId: string): void => {
  const tabs = state.tabs.filter((item) => item.id !== tabId);
  if (tabs.length === state.tabs.length) {
    return;
  }
  state = {
    tabs,
    activeId: state.activeId === tabId ? tabs.at(-1)?.id ?? null : state.activeId
  };
  emit();
};

export const selectDockProblemsTab = (tabId: string): void => {
  if (state.tabs.some((item) => item.id === tabId) === false || state.activeId === tabId) {
    return;
  }
  state = {
    ...state,
    activeId: tabId
  };
  emit();
};

export const clearDockProblemsSelection = (): void => {
  if (state.activeId === null) {
    return;
  }
  state = {
    ...state,
    activeId: null
  };
  emit();
};

export const resetDockProblemsState = (): void => {
  if (state.tabs.length === 0 && state.activeId === null) {
    return;
  }
  state = {
    tabs: [],
    activeId: null
  };
  emit();
};

export const useDockProblems = (): DockProblemsState =>
  useSyncExternalStore(subscribeDockProblems, getDockProblemsState, getDockProblemsState);
