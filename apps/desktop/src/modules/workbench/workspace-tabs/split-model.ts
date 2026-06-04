import type { WorkspaceTabsRuntimeState } from "./runtime-state";
import type {
  WorkspaceTab,
  WorkspaceTabsConfig,
  WorkspaceTabsOptions,
  WorkspaceVisibleLayout
} from "./types";
import { createSearchTab } from "./tab-factory";

const MAX_SPLIT_TAB_COUNT = 4;

export const clampTargetIndex = (targetIndex: number, maxExclusive: number): number => {
  if (Number.isFinite(targetIndex) === false) {
    return maxExclusive;
  }
  return Math.max(0, Math.min(maxExclusive, Math.trunc(targetIndex)));
};

export const insertTabAt = (
  tabs: readonly WorkspaceTab[],
  tab: WorkspaceTab,
  targetIndex: number
): readonly WorkspaceTab[] => {
  const next = [...tabs];
  const insertIndex = clampTargetIndex(targetIndex, next.length);
  next.splice(insertIndex, 0, tab);
  return next;
};

export const reorderTabsById = (
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

export const reorderSplitGroupByTabId = (
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

export const keepSplitGroupContiguous = (
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

export const uniqueTabIds = (tabIds: readonly string[]): readonly string[] => {
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

const uniqueTabsById = (tabs: readonly WorkspaceTab[]): readonly WorkspaceTab[] => {
  const seen = new Set<string>();
  const next: WorkspaceTab[] = [];
  for (const tab of tabs) {
    if (seen.has(tab.id)) {
      continue;
    }
    seen.add(tab.id);
    next.push(tab);
  }
  return next;
};

export const resolveSplitState = (
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

export const resolveRuntimeState = (
  state: WorkspaceTabsRuntimeState,
  config: WorkspaceTabsConfig
): WorkspaceTabsRuntimeState => {
  const tabs = uniqueTabsById(state.tabs);
  if (tabs.length === 0) {
    const fallback = createSearchTab(1, config);
    return {
      tabs: [fallback],
      activeTabId: fallback.id,
      splitGroupTabIds: [],
      focusedSplitTabId: null
    };
  }

  const split = resolveSplitState(
    tabs,
    state.splitGroupTabIds,
    state.focusedSplitTabId
  );
  const normalizedTabs = keepSplitGroupContiguous(tabs, split.splitGroupTabIds);
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

export const applySplitOverflowPolicy = (
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

export const composeSplitGroup = (
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

export const createVisibleWorkspaceLayout = (
  state: WorkspaceTabsRuntimeState
): WorkspaceVisibleLayout => {
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
      mode: "split",
      activeTabId: activeId,
      visibleTabIds: splitGroup.splitGroupTabIds,
      splitGroupTabIds: splitGroup.splitGroupTabIds,
      focusedSplitTabId: splitGroup.focusedSplitTabId ?? splitGroup.splitGroupTabIds[0]!
    };
  }

  return {
    mode: "single",
    activeTabId: activeId,
    visibleTabIds: [activeId],
    splitGroupTabIds: splitGroup.splitGroupTabIds,
    focusedSplitTabId: splitGroup.focusedSplitTabId
  };
};
