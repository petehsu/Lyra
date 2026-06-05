import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentRuntimeEvent,
  AgentSessionCreateRequest,
  AgentSessionSnapshot,
  AgentTurnStatus
} from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import { readWorkbenchStateSync, writeWorkbenchStateSync } from "../state-storage";

export type AiPanelSessionTab = {
  readonly tabId: string;
  readonly sessionId: string | null;
  readonly title: string;
  readonly lastKnownStatus: AgentTurnStatus | null;
  readonly updatedAt?: string | null;
  readonly draftWorkingDir?: string | null;
};

type AiPanelSessionTabsState = {
  readonly tabs: readonly AiPanelSessionTab[];
  readonly activeTabId: string | null;
  readonly activeSessionId: string | null;
};

type AiPanelSessionTabsSnapshot = AiPanelSessionTabsState & {
  readonly version: 2;
};

const AI_PANEL_TABS_STATE_KEY = "ai-panel-tabs" as const;
const DEFAULT_SESSION_TITLE = "新会话";
let draftSerial = 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const sanitizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const sanitizeNullableString = (value: unknown): string | null => {
  if (value === null) return null;
  return sanitizeOptionalString(value) ?? null;
};

const sanitizeStatus = (value: unknown): AgentTurnStatus | null => {
  if (
    value === "idle" ||
    value === "running" ||
    value === "cancelled" ||
    value === "finished" ||
    value === "failed"
  ) {
    return value;
  }
  return null;
};

const createDraftTabId = (): string => {
  draftSerial += 1;
  return `draft-${Date.now().toString(36)}-${draftSerial.toString(36)}`;
};

const createDraftTab = (
  request: AgentSessionCreateRequest = {}
): AiPanelSessionTab => {
  const workingDir = sanitizeOptionalString(request.workingDir) ?? null;
  return {
    tabId: createDraftTabId(),
    sessionId: null,
    title: sanitizeOptionalString(request.title) ?? DEFAULT_SESSION_TITLE,
    lastKnownStatus: null,
    ...(workingDir === null ? {} : { draftWorkingDir: workingDir })
  };
};

const sanitizeTab = (value: unknown): AiPanelSessionTab | null => {
  if (!isRecord(value)) return null;
  const sessionId = sanitizeNullableString(value.sessionId);
  const tabId = sanitizeOptionalString(value.tabId) ?? sessionId ?? undefined;
  if (tabId === undefined) return null;
  const title = sanitizeOptionalString(value.title) ?? DEFAULT_SESSION_TITLE;
  const updatedAt = sanitizeOptionalString(value.updatedAt);
  const draftWorkingDir = sanitizeOptionalString(value.draftWorkingDir);
  return {
    tabId,
    sessionId,
    title,
    lastKnownStatus: sanitizeStatus(value.lastKnownStatus),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(draftWorkingDir === undefined ? {} : { draftWorkingDir })
  };
};

const normalizeTabs = (
  tabs: readonly AiPanelSessionTab[],
  activeTabId: string | null,
  activeSessionId: string | null
): AiPanelSessionTabsState => {
  const seenTabIds = new Set<string>();
  const seenSessionIds = new Set<string>();
  const normalizedTabs: AiPanelSessionTab[] = [];

  for (const tab of tabs) {
    const tabId = tab.tabId.trim();
    const sessionId = tab.sessionId?.trim() || null;
    if (tabId.length === 0 || seenTabIds.has(tabId)) continue;
    if (sessionId !== null && seenSessionIds.has(sessionId)) continue;
    seenTabIds.add(tabId);
    if (sessionId !== null) seenSessionIds.add(sessionId);
    const draftWorkingDir = sanitizeOptionalString(tab.draftWorkingDir);
    normalizedTabs.push({
      tabId,
      sessionId,
      title: tab.title.trim() || DEFAULT_SESSION_TITLE,
      lastKnownStatus: tab.lastKnownStatus,
      ...(tab.updatedAt === undefined ? {} : { updatedAt: tab.updatedAt }),
      ...(draftWorkingDir === undefined ? {} : { draftWorkingDir })
    });
  }

  const activeByTabId =
    activeTabId === null
      ? null
      : normalizedTabs.find((tab) => tab.tabId === activeTabId) ?? null;
  const activeBySessionId =
    activeSessionId === null
      ? null
      : normalizedTabs.find((tab) => tab.sessionId === activeSessionId) ?? null;
  const activeTab = activeByTabId ?? activeBySessionId ?? normalizedTabs[0] ?? null;

  return {
    tabs: normalizedTabs,
    activeTabId: activeTab?.tabId ?? null,
    activeSessionId: activeTab?.sessionId ?? null
  };
};

const ensureDraftTab = (state: AiPanelSessionTabsState): AiPanelSessionTabsState => {
  if (state.tabs.length > 0) return state;
  const draft = createDraftTab();
  return normalizeTabs([draft], draft.tabId, null);
};

export const readAiPanelSessionTabsState = (): AiPanelSessionTabsState => {
  const raw = readWorkbenchStateSync(AI_PANEL_TABS_STATE_KEY);
  if (raw === null) {
    return { tabs: [], activeTabId: null, activeSessionId: null };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.tabs)) {
      return { tabs: [], activeTabId: null, activeSessionId: null };
    }
    const activeTabId = sanitizeOptionalString(parsed.activeTabId) ?? null;
    const activeSessionId = sanitizeOptionalString(parsed.activeSessionId) ?? null;
    return normalizeTabs(
      parsed.tabs
        .map(sanitizeTab)
        .filter((tab): tab is AiPanelSessionTab => tab !== null),
      activeTabId,
      activeSessionId
    );
  } catch (_error) {
    return { tabs: [], activeTabId: null, activeSessionId: null };
  }
};

const writeAiPanelSessionTabsState = (state: AiPanelSessionTabsState): void => {
  const snapshot: AiPanelSessionTabsSnapshot = {
    version: 2,
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activeSessionId: state.activeSessionId
  };
  writeWorkbenchStateSync(AI_PANEL_TABS_STATE_KEY, JSON.stringify(snapshot));
};

const tabFromSnapshot = (
  snapshot: AgentSessionSnapshot,
  tabId = snapshot.id
): AiPanelSessionTab => ({
  tabId,
  sessionId: snapshot.id,
  title: snapshot.title.trim() || DEFAULT_SESSION_TITLE,
  lastKnownStatus: snapshot.turnStatus,
  updatedAt: snapshot.updatedAt
});

const runtimeEventSessionId = (event: AgentRuntimeEvent): string | null => {
  if (event.kind === "sessionSnapshot") return event.snapshot.id;
  if ("sessionId" in event) return event.sessionId;
  return null;
};

const statusFromRuntimeEvent = (event: AgentRuntimeEvent): AgentTurnStatus | null => {
  if (event.kind === "sessionSnapshot") return event.snapshot.turnStatus;
  if (event.kind === "turnStarted" || event.kind === "turnRecovered") return "running";
  if (event.kind === "turnFinished") return event.status;
  if (event.kind === "turnCompleted") return "finished";
  if (event.kind === "turnFailed") return "failed";
  if (event.kind === "turnInterrupted") return "cancelled";
  if (event.kind === "turnStateChanged") {
    if (
      event.state === "completed" ||
      event.state === "cancelled_by_user" ||
      event.state === "failed_recoverable" ||
      event.state === "failed_terminal" ||
      event.state === "interrupted"
    ) {
      return event.state === "completed"
        ? "finished"
        : event.state === "cancelled_by_user" || event.state === "interrupted"
          ? "cancelled"
          : "failed";
    }
    return "running";
  }
  return null;
};

const findTabIndexByIdentity = (
  tabs: readonly AiPanelSessionTab[],
  identity: string
): number => {
  const trimmed = identity.trim();
  if (trimmed.length === 0) return -1;
  return tabs.findIndex((tab) => tab.tabId === trimmed || tab.sessionId === trimmed);
};

export const useWorkbenchAiSessionTabs = (desktopApi: LyraDesktopApi | null) => {
  const [state, setState] = useState<AiPanelSessionTabsState>(() =>
    ensureDraftTab(readAiPanelSessionTabsState())
  );
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
    writeAiPanelSessionTabsState(state);
  }, [state]);

  const upsertSnapshot = useCallback((
    snapshot: AgentSessionSnapshot,
    activate = false
  ): void => {
    const nextTab = tabFromSnapshot(snapshot);
    setState((current) => {
      const activeDraft = current.tabs.find(
        (tab) => tab.tabId === current.activeTabId && tab.sessionId === null
      );
      const existingIndex = current.tabs.findIndex((tab) => tab.sessionId === snapshot.id);
      const tabs =
        existingIndex === -1
          ? [...current.tabs, nextTab]
          : current.tabs.map((tab) =>
              tab.sessionId === snapshot.id ? tabFromSnapshot(snapshot, tab.tabId) : tab
            );
      const nextTabs =
        activate && activeDraft !== undefined && existingIndex === -1
          ? current.tabs.map((tab) =>
              tab.tabId === activeDraft.tabId
                ? tabFromSnapshot(snapshot, activeDraft.tabId)
                : tab
            )
          : tabs;
      return normalizeTabs(
        nextTabs,
        activate
          ? (activeDraft?.tabId ?? nextTab.tabId)
          : current.activeTabId ?? nextTab.tabId,
        activate ? snapshot.id : current.activeSessionId
      );
    });
  }, []);

  const activateSession = useCallback((identity: string): void => {
    const trimmed = identity.trim();
    if (trimmed.length === 0) return;
    setState((current) => {
      const target = current.tabs[findTabIndexByIdentity(current.tabs, trimmed)];
      if (target === undefined) return current;
      return normalizeTabs(current.tabs, target.tabId, target.sessionId);
    });
  }, []);

  const openSession = useCallback((sessionId: string): void => {
    const trimmed = sessionId.trim();
    if (trimmed.length === 0) return;
    setState((current) => {
      const existing = current.tabs.find((tab) => tab.sessionId === trimmed);
      if (existing !== undefined) {
        return normalizeTabs(current.tabs, existing.tabId, trimmed);
      }
      const tab = {
        tabId: trimmed,
        sessionId: trimmed,
        title: DEFAULT_SESSION_TITLE,
        lastKnownStatus: null
      } satisfies AiPanelSessionTab;
      return normalizeTabs([...current.tabs, tab], tab.tabId, trimmed);
    });
  }, []);

  const createDraftSession = useCallback((request: AgentSessionCreateRequest = {}): void => {
    const draft = createDraftTab(request);
    setState((current) => normalizeTabs([...current.tabs, draft], draft.tabId, null));
  }, []);

  const closeSession = useCallback((identity: string): void => {
    const trimmed = identity.trim();
    if (trimmed.length === 0) return;
    setState((current) => {
      const closingIndex = findTabIndexByIdentity(current.tabs, trimmed);
      if (closingIndex === -1) return current;
      const closing = current.tabs[closingIndex]!;
      const nextTabs = current.tabs.filter((tab) => tab.tabId !== closing.tabId);
      if (nextTabs.length === 0) {
        return ensureDraftTab({ tabs: [], activeTabId: null, activeSessionId: null });
      }
      if (current.activeTabId !== closing.tabId) {
        return normalizeTabs(nextTabs, current.activeTabId, current.activeSessionId);
      }
      const nextActive =
        nextTabs[Math.min(closingIndex, nextTabs.length - 1)]
        ?? nextTabs[closingIndex - 1]
        ?? null;
      return normalizeTabs(nextTabs, nextActive?.tabId ?? null, nextActive?.sessionId ?? null);
    });
  }, []);

  const removeSession = useCallback((sessionId: string): void => {
    const trimmed = sessionId.trim();
    if (trimmed.length === 0) return;
    setState((current) => {
      const removeIndex = current.tabs.findIndex((tab) => tab.sessionId === trimmed);
      if (removeIndex === -1) return current;
      const removedActive = current.tabs.some(
        (tab) => tab.sessionId === trimmed && tab.tabId === current.activeTabId
      );
      const nextTabs = current.tabs.filter((tab) => tab.sessionId !== trimmed);
      if (nextTabs.length === 0) {
        return ensureDraftTab({ tabs: [], activeTabId: null, activeSessionId: null });
      }
      if (!removedActive) {
        return normalizeTabs(nextTabs, current.activeTabId, current.activeSessionId);
      }
      const nextActive =
        nextTabs[Math.min(removeIndex, nextTabs.length - 1)]
        ?? nextTabs[removeIndex - 1]
        ?? null;
      return normalizeTabs(nextTabs, nextActive?.tabId ?? null, nextActive?.sessionId ?? null);
    });
  }, []);

  const reorderSessionTabs = useCallback((
    sourceIdentity: string,
    targetIdentity: string
  ): void => {
    setState((current) => {
      const sourceIndex = findTabIndexByIdentity(current.tabs, sourceIdentity);
      const targetIndex = findTabIndexByIdentity(current.tabs, targetIdentity);
      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
        return current;
      }
      const nextTabs = [...current.tabs];
      const [source] = nextTabs.splice(sourceIndex, 1);
      if (source === undefined) return current;
      nextTabs.splice(targetIndex, 0, source);
      return normalizeTabs(nextTabs, current.activeTabId, current.activeSessionId);
    });
  }, []);

  const createSession = useCallback(async (
    request: AgentSessionCreateRequest
  ): Promise<AgentSessionSnapshot> => {
    if (desktopApi?.agent === undefined) {
      throw new Error("Agent runtime bridge is unavailable.");
    }
    const snapshot = await desktopApi.agent.createSession(request);
    upsertSnapshot(snapshot, true);
    return snapshot;
  }, [desktopApi, upsertSnapshot]);

  useEffect(() => {
    if (desktopApi?.agent === undefined) return undefined;
    const agentApi = desktopApi.agent;
    return agentApi.onEvent((event) => {
      const sessionId = runtimeEventSessionId(event);
      if (sessionId === null) return;
      const known = stateRef.current.tabs.some((tab) => tab.sessionId === sessionId);
      if (!known) return;
      if (event.kind === "sessionSnapshot") {
        upsertSnapshot(event.snapshot);
        return;
      }
      const status = statusFromRuntimeEvent(event);
      if (status !== null) {
        setState((current) => normalizeTabs(
          current.tabs.map((tab) =>
            tab.sessionId === sessionId
              ? { ...tab, lastKnownStatus: status }
              : tab
          ),
          current.activeTabId,
          current.activeSessionId
        ));
      }
      if (
        event.kind === "turnFinished" ||
        event.kind === "turnFailed" ||
        event.kind === "turnInterrupted" ||
        event.kind === "turnCompleted"
      ) {
        void agentApi.readSession({ sessionId })
          .then((snapshot) => upsertSnapshot(snapshot))
          .catch(() => removeSession(sessionId));
      }
    });
  }, [desktopApi, removeSession, upsertSnapshot]);

  const activeTab =
    state.tabs.find((tab) => tab.tabId === state.activeTabId)
    ?? state.tabs.find((tab) => tab.sessionId === state.activeSessionId)
    ?? null;

  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activeSessionId: state.activeSessionId,
    activeTab,
    activateSession,
    openSession,
    closeSession,
    removeSession,
    reorderSessionTabs,
    createDraftSession,
    createSession,
    upsertSnapshot
  };
};
