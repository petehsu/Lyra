import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentMessage,
  AgentPageCitation,
  AgentRuntimeEvent,
  AgentSessionCreateRequest,
  AgentSessionSnapshot,
  AgentTranscriptCitation,
  AgentTurnStatus
} from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import { workbenchChromeBus } from "../shell/workbench-chrome-bus";
import { readWorkbenchStateSync, writeWorkbenchStateSync } from "../state-storage";
import { t } from "@workbench/i18n";
import type { AgentImageAttachment } from "./lyra-agents/core/types";
import {
  normalizeInlineImageAttachment,
  parseInlineImagesFromMetadata
} from "./lyra-agents/features/chat/composer-image";
import { parseFileAttachmentsFromMetadata, type AgentFileAttachment } from "./lyra-agents/features/chat/composer-file";
import {
  parseTranscriptCitationsFromMetadata,
  selectRecordsForMarkerText
} from "./lyra-agents/features/chat/message-citation";
import { parsePageCitationsFromMetadata } from "./lyra-agents/features/chat/page-citation";

export type AiPanelSessionTabReferences = {
  readonly inlineImages: readonly AgentImageAttachment[];
  readonly fileAttachments: readonly AgentFileAttachment[];
  readonly pageCitations: readonly AgentPageCitation[];
  readonly transcriptCitations: readonly AgentTranscriptCitation[];
};

export type AiPanelSessionTab = {
  readonly tabId: string;
  readonly sessionId: string | null;
  readonly title: string;
  readonly lastKnownStatus: AgentTurnStatus | null;
  readonly updatedAt?: string | null;
  readonly workingDir?: string | null;
  readonly projectBound?: boolean;
  readonly workingDirIsHome?: boolean;
  readonly draftWorkingDir?: string | null;
  readonly references?: AiPanelSessionTabReferences;
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

const sanitizeTabTitle = (value: unknown): string =>
  sanitizeOptionalString(typeof value === "string" ? value : "")
  ?? t("aiPanel.defaultSessionTitle");

const referencesFromMessages = (
  title: string,
  messages: readonly AgentMessage[]
): AiPanelSessionTabReferences | undefined => {
  const images = new Map<string, AgentImageAttachment>();
  const rememberImage = (image: AgentImageAttachment): void => {
    const current = images.get(image.id);
    if (current === undefined || (current.label ?? "").trim().length === 0) {
      images.set(image.id, image);
    }
  };
  const files: AgentFileAttachment[] = [];
  const pages: AgentPageCitation[] = [];
  const citations: AgentTranscriptCitation[] = [];
  for (const message of messages) {
    for (const image of parseInlineImagesFromMetadata(message.metadata)) {
      rememberImage(image);
    }
    for (const block of message.blocks ?? []) {
      if (block.type !== "image") {
        continue;
      }
      const image = normalizeInlineImageAttachment(block);
      if (image !== null) {
        rememberImage(image);
      }
    }
    files.push(...parseFileAttachmentsFromMetadata(message.metadata));
    pages.push(...parsePageCitationsFromMetadata(message.metadata));
    citations.push(...parseTranscriptCitationsFromMetadata(message.metadata));
  }
  const selected = selectRecordsForMarkerText(title, {
    inlineImages: [...images.values()],
    fileAttachments: files,
    pageCitations: pages,
    transcriptCitations: citations
  });
  if (
    selected.inlineImages.length === 0
    && selected.fileAttachments.length === 0
    && selected.pageCitations.length === 0
    && selected.transcriptCitations.length === 0
  ) {
    return undefined;
  }
  return selected;
};

const sanitizeStoredImage = (value: unknown): AgentImageAttachment | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = sanitizeOptionalString(value.id);
  const mediaType = sanitizeOptionalString(value.mediaType);
  if (id === undefined || mediaType === undefined) {
    return null;
  }
  return {
    id,
    mediaType,
    label: typeof value.label === "string" ? value.label : null,
    source: typeof value.source === "string" ? value.source : null
  };
};

const sanitizeReferences = (value: unknown): AiPanelSessionTabReferences | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const inlineImages = Array.isArray(value.inlineImages)
    ? value.inlineImages.flatMap((entry) => {
        const image = sanitizeStoredImage(entry);
        return image === null ? [] : [image];
      })
    : [];
  const fileAttachments = parseFileAttachmentsFromMetadata({
    fileAttachments: value.fileAttachments
  });
  const pageCitations = parsePageCitationsFromMetadata({
    pageCitations: value.pageCitations
  });
  const transcriptCitations = parseTranscriptCitationsFromMetadata({
    transcriptCitations: value.transcriptCitations
  });
  if (
    inlineImages.length === 0
    && fileAttachments.length === 0
    && pageCitations.length === 0
    && transcriptCitations.length === 0
  ) {
    return undefined;
  }
  return { inlineImages, fileAttachments, pageCitations, transcriptCitations };
};

const sanitizeStatus = (value: unknown): AgentTurnStatus | null => {
  if (
    value === "idle" ||
    value === "running" ||
    value === "cancelled"
  ) {
    return value;
  }
  if (value === "finished" || value === "failed") {
    return "idle";
  }
  return null;
};

// OpenCode session_working is live sync, not a disk badge. Restoring
// "running" from workspace JSON makes every leftover tab spin after crash.
const sanitizeRestoredStatus = (value: unknown): AgentTurnStatus | null => {
  const status = sanitizeStatus(value);
  return status === "running" ? null : status;
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
    title: sanitizeTabTitle(request.title),
    lastKnownStatus: null,
    ...(workingDir === null ? {} : { draftWorkingDir: workingDir })
  };
};

const sanitizeTab = (value: unknown): AiPanelSessionTab | null => {
  if (!isRecord(value)) return null;
  const sessionId = sanitizeNullableString(value.sessionId);
  const tabId = sanitizeOptionalString(value.tabId) ?? sessionId ?? undefined;
  if (tabId === undefined) return null;
  const title = sanitizeTabTitle(value.title);
  const updatedAt = sanitizeOptionalString(value.updatedAt);
  const workingDir = sanitizeOptionalString(value.workingDir);
  const draftWorkingDir = sanitizeOptionalString(value.draftWorkingDir);
  const references = sanitizeReferences(value.references);
  return {
    tabId,
    sessionId,
    title,
    lastKnownStatus: sanitizeRestoredStatus(value.lastKnownStatus),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(workingDir === undefined ? {} : { workingDir }),
    ...(typeof value.projectBound === "boolean" ? { projectBound: value.projectBound } : {}),
    ...(typeof value.workingDirIsHome === "boolean" ? { workingDirIsHome: value.workingDirIsHome } : {}),
    ...(draftWorkingDir === undefined ? {} : { draftWorkingDir }),
    ...(references === undefined ? {} : { references })
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
    const workingDir = sanitizeOptionalString(tab.workingDir);
    normalizedTabs.push({
      tabId,
      sessionId,
      title: sanitizeTabTitle(tab.title),
      lastKnownStatus: tab.lastKnownStatus,
      ...(tab.updatedAt === undefined ? {} : { updatedAt: tab.updatedAt }),
      ...(workingDir === undefined ? {} : { workingDir }),
      ...(tab.projectBound === undefined ? {} : { projectBound: tab.projectBound }),
      ...(tab.workingDirIsHome === undefined ? {} : { workingDirIsHome: tab.workingDirIsHome }),
      ...(draftWorkingDir === undefined ? {} : { draftWorkingDir }),
      ...(tab.references === undefined ? {} : { references: tab.references })
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
  tabId = snapshot.id,
  previous?: AiPanelSessionTab
): AiPanelSessionTab => {
  const title = sanitizeTabTitle(snapshot.title);
  const extracted = referencesFromMessages(title, snapshot.messages);
  const references = extracted ?? (
    title.includes("⟦") ? previous?.references : undefined
  );
  return {
    tabId,
    sessionId: snapshot.id,
    title,
    lastKnownStatus: snapshot.turnStatus,
    updatedAt: snapshot.updatedAt,
    workingDir: snapshot.workingDir,
    projectBound: snapshot.projectBound,
    ...(snapshot.workingDirIsHome === undefined ? {} : { workingDirIsHome: snapshot.workingDirIsHome }),
    ...(references === undefined ? {} : { references })
  };
};

const sessionTabsEqual = (
  left: AiPanelSessionTab,
  right: AiPanelSessionTab
): boolean =>
  left.tabId === right.tabId
  && left.sessionId === right.sessionId
  && left.title === right.title
  && left.lastKnownStatus === right.lastKnownStatus
  && left.updatedAt === right.updatedAt
  && left.workingDir === right.workingDir
  && left.projectBound === right.projectBound
  && left.workingDirIsHome === right.workingDirIsHome
  && left.draftWorkingDir === right.draftWorkingDir
  && JSON.stringify(left.references ?? null) === JSON.stringify(right.references ?? null);

const runtimeEventSessionId = (event: AgentRuntimeEvent): string | null => {
  if (event.kind === "sessionSnapshot") return event.snapshot.id;
  if ("sessionId" in event) return event.sessionId;
  return null;
};

const statusFromRuntimeEvent = (event: AgentRuntimeEvent): AgentTurnStatus | null => {
  if (event.kind === "sessionSnapshot") return event.snapshot.turnStatus;
  if (event.kind === "turnStarted" || event.kind === "turnRecovered") return "running";
  if (event.kind === "turnFinished") return event.status === "cancelled" ? "cancelled" : "idle";
  if (event.kind === "turnCompleted") return "idle";
  if (event.kind === "turnFailed") return "idle";
  if (event.kind === "turnInterrupted") return "cancelled";
  if (event.kind === "turnStateChanged") {
    const state = event.state as string;
    if (
      state === "completed" ||
      state === "cancelled_by_user" ||
      state === "cancelled" ||
      state === "interrupted"
    ) {
      return state === "cancelled_by_user" ||
            state === "cancelled" ||
            state === "interrupted"
          ? "cancelled"
          : "idle";
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
      const existingTab = existingIndex < 0 ? undefined : current.tabs[existingIndex];
      if (
        activate === false
        && existingTab !== undefined
        && sessionTabsEqual(existingTab, tabFromSnapshot(snapshot, existingTab.tabId, existingTab))
      ) {
        return current;
      }
      const tabs =
        existingIndex === -1
          ? [...current.tabs, nextTab]
          : current.tabs.map((tab) =>
              tab.sessionId === snapshot.id ? tabFromSnapshot(snapshot, tab.tabId, tab) : tab
            );
      const nextTabs =
        activate && activeDraft !== undefined && existingIndex === -1
          ? current.tabs.map((tab) =>
              tab.tabId === activeDraft.tabId
                ? tabFromSnapshot(snapshot, activeDraft.tabId, activeDraft)
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
        title: t("aiPanel.defaultSessionTitle"),
        lastKnownStatus: null
      } satisfies AiPanelSessionTab;
      return normalizeTabs([...current.tabs, tab], tab.tabId, trimmed);
    });
  }, []);

  const createDraftSession = useCallback((request: AgentSessionCreateRequest = {}): void => {
    setState((current) => {
      const draft = createDraftTab(request);
      return normalizeTabs([...current.tabs, draft], draft.tabId, null);
    });
  }, []);

  const setDraftWorkingDir = useCallback((tabId: string, workingDir: string): void => {
    const trimmedTabId = tabId.trim();
    const trimmedWorkingDir = workingDir.trim();
    if (trimmedTabId.length === 0 || trimmedWorkingDir.length === 0) return;
    setState((current) => {
      const target = current.tabs.find((tab) => tab.tabId === trimmedTabId);
      // Only un-backed draft tabs carry an editable working dir. Once a tab has a
      // real sessionId its binding is owned by the runtime and is immutable.
      if (target === undefined || target.sessionId !== null) return current;
      const nextTabs = current.tabs.map((tab) =>
        tab.tabId === trimmedTabId
          ? { ...tab, draftWorkingDir: trimmedWorkingDir }
          : tab
      );
      return normalizeTabs(nextTabs, current.activeTabId, current.activeSessionId);
    });
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
    workbenchChromeBus.clearAiSession(trimmed);
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
        setState((current) => {
          const target = current.tabs.find((tab) => tab.sessionId === sessionId);
          if (target?.lastKnownStatus === status) {
            return current;
          }
          return normalizeTabs(
            current.tabs.map((tab) =>
            tab.sessionId === sessionId
              ? { ...tab, lastKnownStatus: status }
              : tab
            ),
            current.activeTabId,
            current.activeSessionId
          );
        });
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

  useEffect(() => {
    if (desktopApi?.agent === undefined) {
      return undefined;
    }
    const agentApi = desktopApi.agent;
    const pending = stateRef.current.tabs.filter((tab) =>
      tab.sessionId !== null && tab.title.includes("⟦") && tab.references === undefined
    );
    if (pending.length === 0) {
      return undefined;
    }
    let cancelled = false;
    for (const tab of pending) {
      const sessionId = tab.sessionId;
      if (sessionId === null) {
        continue;
      }
      void agentApi.readSession({ sessionId })
        .then((snapshot) => {
          if (!cancelled) {
            upsertSnapshot(snapshot);
          }
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [desktopApi, upsertSnapshot]);

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
    setDraftWorkingDir,
    createSession,
    upsertSnapshot
  };
};
