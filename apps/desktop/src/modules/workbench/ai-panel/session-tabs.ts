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
  readonly sessionId: string;
  readonly title: string;
  readonly lastKnownStatus: AgentTurnStatus | null;
  readonly updatedAt?: string | null;
};

type AiPanelSessionTabsState = {
  readonly tabs: readonly AiPanelSessionTab[];
  readonly activeSessionId: string | null;
};

type AiPanelSessionTabsSnapshot = AiPanelSessionTabsState & {
  readonly version: 1;
};

const AI_PANEL_TABS_STATE_KEY = "ai-panel-tabs" as const;
const DEFAULT_SESSION_TITLE = "新会话";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const sanitizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

const sanitizeTab = (value: unknown): AiPanelSessionTab | null => {
  if (!isRecord(value)) return null;
  const sessionId = sanitizeOptionalString(value.sessionId);
  if (sessionId === undefined) return null;
  const title = sanitizeOptionalString(value.title) ?? DEFAULT_SESSION_TITLE;
  const updatedAt = sanitizeOptionalString(value.updatedAt);
  return {
    sessionId,
    title,
    lastKnownStatus: sanitizeStatus(value.lastKnownStatus),
    ...(updatedAt === undefined ? {} : { updatedAt })
  };
};

const normalizeTabs = (
  tabs: readonly AiPanelSessionTab[],
  activeSessionId: string | null
): AiPanelSessionTabsState => {
  const seen = new Set<string>();
  const normalizedTabs: AiPanelSessionTab[] = [];
  for (const tab of tabs) {
    const sessionId = tab.sessionId.trim();
    if (sessionId.length === 0 || seen.has(sessionId)) continue;
    seen.add(sessionId);
    normalizedTabs.push({
      sessionId,
      title: tab.title.trim() || DEFAULT_SESSION_TITLE,
      lastKnownStatus: tab.lastKnownStatus,
      ...(tab.updatedAt === undefined ? {} : { updatedAt: tab.updatedAt })
    });
  }

  const normalizedActive =
    activeSessionId !== null && normalizedTabs.some((tab) => tab.sessionId === activeSessionId)
      ? activeSessionId
      : normalizedTabs[0]?.sessionId ?? null;

  return {
    tabs: normalizedTabs,
    activeSessionId: normalizedActive
  };
};

export const readAiPanelSessionTabsState = (): AiPanelSessionTabsState => {
  const raw = readWorkbenchStateSync(AI_PANEL_TABS_STATE_KEY);
  if (raw === null) {
    return { tabs: [], activeSessionId: null };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.tabs)) {
      return { tabs: [], activeSessionId: null };
    }
    const activeSessionId = sanitizeOptionalString(parsed.activeSessionId) ?? null;
    return normalizeTabs(
      parsed.tabs
        .map(sanitizeTab)
        .filter((tab): tab is AiPanelSessionTab => tab !== null),
      activeSessionId
    );
  } catch (_error) {
    return { tabs: [], activeSessionId: null };
  }
};

const writeAiPanelSessionTabsState = (state: AiPanelSessionTabsState): void => {
  const snapshot: AiPanelSessionTabsSnapshot = {
    version: 1,
    tabs: state.tabs,
    activeSessionId: state.activeSessionId
  };
  writeWorkbenchStateSync(AI_PANEL_TABS_STATE_KEY, JSON.stringify(snapshot));
};

const tabFromSnapshot = (snapshot: AgentSessionSnapshot): AiPanelSessionTab => ({
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

export const useWorkbenchAiSessionTabs = (desktopApi: LyraDesktopApi | null) => {
  const [state, setState] = useState<AiPanelSessionTabsState>(() =>
    readAiPanelSessionTabsState()
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
      const exists = current.tabs.some((tab) => tab.sessionId === nextTab.sessionId);
      const tabs = exists
          ? current.tabs.map((tab) => tab.sessionId === nextTab.sessionId ? nextTab : tab)
          : [...current.tabs, nextTab];
      return normalizeTabs(
        tabs,
        activate ? nextTab.sessionId : current.activeSessionId ?? nextTab.sessionId
      );
    });
  }, []);

  const activateSession = useCallback((sessionId: string): void => {
    const trimmed = sessionId.trim();
    if (trimmed.length === 0) return;
    setState((current) => normalizeTabs(current.tabs, trimmed));
  }, []);

  const openSession = useCallback((sessionId: string): void => {
    const trimmed = sessionId.trim();
    if (trimmed.length === 0) return;
    setState((current) => {
      const exists = current.tabs.some((tab) => tab.sessionId === trimmed);
      return normalizeTabs(
        exists
          ? current.tabs
          : [
              ...current.tabs,
              {
                sessionId: trimmed,
                title: DEFAULT_SESSION_TITLE,
                lastKnownStatus: null
              }
            ],
        trimmed
      );
    });
  }, []);

  const closeSession = useCallback((sessionId: string): void => {
    const trimmed = sessionId.trim();
    if (trimmed.length === 0) return;
    setState((current) => {
      const closingIndex = current.tabs.findIndex((tab) => tab.sessionId === trimmed);
      if (closingIndex === -1) return current;
      const nextTabs = current.tabs.filter((tab) => tab.sessionId !== trimmed);
      if (current.activeSessionId !== trimmed) {
        return normalizeTabs(nextTabs, current.activeSessionId);
      }
      const nextActive =
        nextTabs[Math.min(closingIndex, nextTabs.length - 1)]?.sessionId
        ?? nextTabs[closingIndex - 1]?.sessionId
        ?? null;
      return normalizeTabs(nextTabs, nextActive);
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
          .catch(() => undefined);
      }
    });
  }, [desktopApi, upsertSnapshot]);

  return {
    tabs: state.tabs,
    activeSessionId: state.activeSessionId,
    activateSession,
    openSession,
    closeSession,
    createSession,
    upsertSnapshot
  };
};
