import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentMessage,
  AgentRuntimeStreamEvent,
  AgentSession,
  AgentSessionDetail
} from "../ai-panel/agent-ui-types";
import {
  normalizeProjectRoot,
  useProjectLogoMap
} from "../project-identity";
import { emitThreadSelected } from "../thread-selection-events";
import {
  lyraThreadToAgentDetail,
  readLyraThread
} from "../ai-panel/lyra-thread-adapter";
import {
  createAiHistoryRequestPayload,
  createPreviewThreadSummary,
  groupThreadsByProject,
  isArchivedHistoryScope,
  isProjectHistoryScope,
  resolveThreadPreviewText,
  sortThreadsByRecency,
  toThreadSummary,
  type HistoryScope,
  type JsonRecord,
  type LivePreviewEntry,
  type LyraThreadSummary,
  type ProjectGroup
} from "./model";
import type { AiHistorySurfaceProps } from "./types";

type UseAiHistoryRuntimeOptions = {
  readonly desktopApi: AiHistorySurfaceProps["desktopApi"];
  readonly openDialog: AiHistorySurfaceProps["openDialog"] | undefined;
  readonly deleteArchivedConversationTitle: string;
  readonly deleteArchivedConversationDescription: string;
  readonly deleteArchivedConversationConfirm: string;
  readonly deleteArchivedConversationCancel: string;
  readonly threadPreviewEmptyLabel: string;
};

type LegacyLyraApi = {
  readonly request: (payload: Readonly<Record<string, unknown>>) => Promise<unknown>;
};

const getLegacyLyraApi = (
  desktopApi: AiHistorySurfaceProps["desktopApi"]
): LegacyLyraApi | null => {
  if (desktopApi === null || typeof desktopApi !== "object") {
    return null;
  }
  const value = (desktopApi as unknown as { readonly lyra?: unknown }).lyra;
  if (value === null || typeof value !== "object") {
    return null;
  }
  const request = (value as { readonly request?: unknown }).request;
  return typeof request === "function"
    ? { request: request as LegacyLyraApi["request"] }
    : null;
};

const readRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;

const readDetailFromPayload = (payload: unknown): AgentSessionDetail | null => {
  const record = readRecord(payload);
  const detail = readRecord(record?.detail);
  return detail !== null && readRecord(detail.session) !== null
    ? detail as unknown as AgentSessionDetail
    : null;
};

const latestMessagePreview = (messages: readonly AgentMessage[]): string =>
  [...messages]
    .reverse()
    .map((message) => (message.displayContent ?? message.content).trim())
    .find((content) => content.length > 0)
  ?? "";

const sessionToThreadSummary = (session: AgentSession): LyraThreadSummary => ({
  id: session.id,
  name: session.title,
  preview: "",
  updatedAt: session.updatedAt,
  modelProvider: session.profileId ?? null,
  boundProjectRoot: session.projectRoot ?? null
});

const detailToThreadSummary = (detail: AgentSessionDetail): LyraThreadSummary => ({
  ...createPreviewThreadSummary(detail),
  preview: latestMessagePreview(detail.messages),
  modelProvider: detail.turns.at(-1)?.profileId ?? detail.session.profileId ?? null
});

const parseThreadList = (response: unknown): readonly LyraThreadSummary[] => {
  const record = readRecord(response);
  const data = Array.isArray(record?.data) ? record.data : [];
  return sortThreadsByRecency(
    data.map(toThreadSummary).filter((thread): thread is LyraThreadSummary => thread !== null)
  );
};

const updateThreadBucket = (
  current: readonly LyraThreadSummary[],
  thread: LyraThreadSummary
): readonly LyraThreadSummary[] => {
  const existingIndex = current.findIndex((entry) => entry.id === thread.id);
  const next = existingIndex < 0
    ? [thread, ...current]
    : [
        ...current.slice(0, existingIndex),
        thread,
        ...current.slice(existingIndex + 1)
      ];
  return sortThreadsByRecency(next);
};

export type AiHistoryRuntimeActions = {
  readonly previewThread: (threadId: string, options?: { readonly silent?: boolean }) => Promise<void>;
  readonly openThread: (threadId: string) => void;
  readonly archiveThread: (threadId: string) => Promise<void>;
  readonly unarchiveThread: (threadId: string) => Promise<void>;
  readonly requestDeleteThread: (thread: LyraThreadSummary) => void;
  readonly beginRenameThread: (thread: LyraThreadSummary) => void;
  readonly cancelRenameThread: () => void;
  readonly submitRenameThread: (threadId: string) => Promise<void>;
  readonly setEditingThreadName: (value: string) => void;
  readonly selectScope: (scope: HistoryScope) => void;
  readonly selectProject: (projectRoot: string) => void;
  readonly clearSelectedProject: () => void;
};

export type AiHistoryRuntime = {
  readonly lyraAvailable: boolean;
  readonly activeThreads: readonly LyraThreadSummary[];
  readonly archivedThreads: readonly LyraThreadSummary[];
  readonly threads: readonly LyraThreadSummary[];
  readonly scope: HistoryScope;
  readonly selectedProjectRoot: string | null;
  readonly selectedProject: ProjectGroup | null;
  readonly projectGroups: readonly ProjectGroup[];
  readonly activeProjectGroupCount: number;
  readonly archivedProjectGroupCount: number;
  readonly activeThreadId: string | null;
  readonly previewDetail: AgentSessionDetail | null;
  readonly isPreviewLoading: boolean;
  readonly previewError: string | null;
  readonly livePreviewByThread: ReadonlyMap<string, LivePreviewEntry>;
  readonly hasLoadedThreads: boolean;
  readonly isLoading: boolean;
  readonly editingThreadId: string | null;
  readonly editingThreadName: string;
  readonly isRenamingThread: boolean;
  readonly errorMessage: string | null;
  readonly isArchivedScope: boolean;
  readonly isProjectScope: boolean;
  readonly projectLogoByRoot: ReadonlyMap<string, string | null>;
  readonly getThreadSummaryById: (threadId: string) => LyraThreadSummary | null;
  readonly actions: AiHistoryRuntimeActions;
};

export const useAiHistoryRuntime = ({
  desktopApi,
  openDialog,
  deleteArchivedConversationTitle,
  deleteArchivedConversationDescription,
  deleteArchivedConversationConfirm,
  deleteArchivedConversationCancel,
  threadPreviewEmptyLabel
}: UseAiHistoryRuntimeOptions): AiHistoryRuntime => {
  const [activeThreads, setActiveThreads] = useState<readonly LyraThreadSummary[]>([]);
  const [archivedThreads, setArchivedThreads] = useState<readonly LyraThreadSummary[]>([]);
  const [scope, setScope] = useState<HistoryScope>("global");
  const [selectedProjectRoot, setSelectedProjectRoot] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [previewDetail, setPreviewDetail] = useState<AgentSessionDetail | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [livePreviewByThread, setLivePreviewByThread] = useState<ReadonlyMap<string, LivePreviewEntry>>(
    () => new Map()
  );
  const [hasLoadedThreads, setHasLoadedThreads] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingThreadName, setEditingThreadName] = useState("");
  const [isRenamingThread, setIsRenamingThread] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const previewRequestSeq = useRef(0);
  const didAutoPreviewLatestRef = useRef(false);
  const legacyLyraApi = useMemo(() => getLegacyLyraApi(desktopApi), [desktopApi]);
  const isArchivedScope = isArchivedHistoryScope(scope);
  const isProjectScope = isProjectHistoryScope(scope);
  const threads = isArchivedScope ? archivedThreads : activeThreads;

  const activeProjectGroups = useMemo(
    () => groupThreadsByProject(activeThreads),
    [activeThreads]
  );
  const archivedProjectGroups = useMemo(
    () => groupThreadsByProject(archivedThreads),
    [archivedThreads]
  );
  const projectGroups = isArchivedScope ? archivedProjectGroups : activeProjectGroups;

  const selectedProject = useMemo<ProjectGroup | null>(() => {
    if (selectedProjectRoot === null) {
      return null;
    }
    return projectGroups.find((group) => group.projectRoot === selectedProjectRoot) ?? null;
  }, [projectGroups, selectedProjectRoot]);
  const projectRoots = useMemo(
    () => [
      ...activeThreads,
      ...archivedThreads
    ]
      .map((thread) => normalizeProjectRoot(thread.boundProjectRoot))
      .filter((root): root is string => root !== null),
    [activeThreads, archivedThreads]
  );
  const projectLogoByRoot = useProjectLogoMap(desktopApi?.files, projectRoots);
  const latestThread = useMemo(() => {
    const latestActive = activeThreads[0] ?? null;
    const latestArchived = archivedThreads[0] ?? null;
    if (latestActive === null) {
      return latestArchived === null ? null : { thread: latestArchived, archived: true };
    }
    if (latestArchived === null || (latestActive.updatedAt ?? 0) >= (latestArchived.updatedAt ?? 0)) {
      return { thread: latestActive, archived: false };
    }
    return { thread: latestArchived, archived: true };
  }, [activeThreads, archivedThreads]);

  const loadThreads = useCallback(async (): Promise<void> => {
    const agentApi = desktopApi?.ai;
    if (agentApi === undefined && legacyLyraApi === null) {
      setErrorMessage(null);
      setIsLoading(false);
      setHasLoadedThreads(false);
      setActiveThreads([]);
      setArchivedThreads([]);
      return;
    }
    setErrorMessage(null);
    setIsLoading(true);
    didAutoPreviewLatestRef.current = false;
    try {
      if (agentApi !== undefined) {
        const sessions = await agentApi.listSessions();
        setActiveThreads(sortThreadsByRecency(sessions.map(sessionToThreadSummary)));
        setArchivedThreads([]);
      } else if (legacyLyraApi !== null) {
        const [activeResponse, archivedResponse] = await Promise.all([
          legacyLyraApi.request(createAiHistoryRequestPayload("thread/list", { archived: false })),
          legacyLyraApi.request(createAiHistoryRequestPayload("thread/list", { archived: true }))
        ]);
        setActiveThreads(parseThreadList(activeResponse));
        setArchivedThreads(parseThreadList(archivedResponse));
      }
      setHasLoadedThreads(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setHasLoadedThreads(true);
    } finally {
      setIsLoading(false);
    }
  }, [desktopApi?.ai, legacyLyraApi]);

  const clearPreview = useCallback((): void => {
    previewRequestSeq.current += 1;
    setActiveThreadId(null);
    setPreviewDetail(null);
    setPreviewError(null);
    setIsPreviewLoading(false);
  }, []);

  const patchThreadName = useCallback((threadId: string, name: string): void => {
    const patch = (current: readonly LyraThreadSummary[]): readonly LyraThreadSummary[] =>
      current.map((thread) => thread.id === threadId ? { ...thread, name } : thread);
    setActiveThreads(patch);
    setArchivedThreads(patch);
    setPreviewDetail((current) =>
      current === null || current.session.id !== threadId
        ? current
        : {
            ...current,
            session: {
              ...current.session,
              title: name
            }
          }
    );
  }, []);

  const previewThread = useCallback(
    async (threadId: string, options: { readonly silent?: boolean } = {}): Promise<void> => {
      const agentApi = desktopApi?.ai;
      const silent = options.silent === true;
      const requestSeq = previewRequestSeq.current + 1;
      previewRequestSeq.current = requestSeq;
      setActiveThreadId(threadId);
      if (!silent) {
        setPreviewDetail(null);
        setPreviewError(null);
        setIsPreviewLoading(true);
      }
      try {
        let detail: AgentSessionDetail | null = null;
        if (agentApi !== undefined) {
          detail = await agentApi.readSession({ sessionId: threadId });
        } else if (legacyLyraApi !== null) {
          const response = await legacyLyraApi.request(
            createAiHistoryRequestPayload("thread/read", {
              threadId,
              includeTurns: true
            })
          );
          const thread = readLyraThread(readRecord(response)?.thread);
          detail = thread === null ? null : lyraThreadToAgentDetail(thread);
        }
        if (previewRequestSeq.current !== requestSeq) {
          return;
        }
        if (detail === null) {
          setPreviewDetail(null);
          setPreviewError("Thread could not be loaded.");
          return;
        }
        setPreviewDetail(detail);
        setPreviewError(null);
        const summary = detailToThreadSummary(detail);
        setActiveThreads((current) =>
          current.some((thread) => thread.id === summary.id)
            ? updateThreadBucket(current, summary)
            : current
        );
        setArchivedThreads((current) =>
          current.some((thread) => thread.id === summary.id)
            ? updateThreadBucket(current, summary)
            : current
        );
      } catch (error) {
        if (previewRequestSeq.current === requestSeq) {
          setPreviewDetail(null);
          setPreviewError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (previewRequestSeq.current === requestSeq && !silent) {
          setIsPreviewLoading(false);
        }
      }
    },
    [desktopApi?.ai, legacyLyraApi]
  );

  const archiveThread = useCallback(
    async (threadId: string): Promise<void> => {
      setErrorMessage(null);
      const thread = activeThreads.find((entry) => entry.id === threadId) ?? null;
      try {
        if (legacyLyraApi !== null) {
          await legacyLyraApi.request(createAiHistoryRequestPayload("thread/archive", { threadId }));
        }
        if (activeThreadId === threadId) {
          clearPreview();
        }
        setActiveThreads((current) => current.filter((entry) => entry.id !== threadId));
        if (thread !== null) {
          setArchivedThreads((current) => updateThreadBucket(current, thread));
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [activeThreadId, activeThreads, clearPreview, legacyLyraApi]
  );

  const unarchiveThread = useCallback(
    async (threadId: string): Promise<void> => {
      setErrorMessage(null);
      const thread = archivedThreads.find((entry) => entry.id === threadId) ?? null;
      try {
        if (legacyLyraApi !== null) {
          const response = await legacyLyraApi.request(
            createAiHistoryRequestPayload("thread/unarchive", { threadId })
          );
          const restored = toThreadSummary(readRecord(response)?.thread);
          if (restored !== null) {
            setActiveThreads((current) => updateThreadBucket(current, restored));
          } else if (thread !== null) {
            setActiveThreads((current) => updateThreadBucket(current, thread));
          }
        } else if (thread !== null) {
          setActiveThreads((current) => updateThreadBucket(current, thread));
        }
        if (activeThreadId === threadId) {
          clearPreview();
        }
        setArchivedThreads((current) => current.filter((entry) => entry.id !== threadId));
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [activeThreadId, archivedThreads, clearPreview, legacyLyraApi]
  );

  const deleteThread = useCallback(
    async (threadId: string): Promise<void> => {
      setErrorMessage(null);
      try {
        if (legacyLyraApi !== null) {
          await legacyLyraApi.request(createAiHistoryRequestPayload("thread/delete", { threadId }));
        }
        if (activeThreadId === threadId) {
          clearPreview();
        }
        setActiveThreads((current) => current.filter((thread) => thread.id !== threadId));
        setArchivedThreads((current) => current.filter((thread) => thread.id !== threadId));
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [activeThreadId, clearPreview, legacyLyraApi]
  );

  const openThread = useCallback((threadId: string): void => {
    setActiveThreadId(threadId);
    emitThreadSelected(threadId);
  }, []);

  const beginRenameThread = useCallback((thread: LyraThreadSummary): void => {
    setEditingThreadId(thread.id);
    setEditingThreadName(resolveThreadPreviewText(thread, threadPreviewEmptyLabel));
  }, [threadPreviewEmptyLabel]);

  const cancelRenameThread = useCallback((): void => {
    setEditingThreadId(null);
    setEditingThreadName("");
  }, []);

  const submitRenameThread = useCallback(async (threadId: string): Promise<void> => {
    if (isRenamingThread) {
      return;
    }
    const name = editingThreadName.trim();
    if (name.length === 0) {
      cancelRenameThread();
      return;
    }
    setIsRenamingThread(true);
    setErrorMessage(null);
    try {
      if (desktopApi?.ai !== undefined) {
        const detail = await desktopApi.ai.updateSession({ sessionId: threadId, title: name });
        setPreviewDetail((current) => current?.session.id === threadId ? detail : current);
      } else if (legacyLyraApi !== null) {
        await legacyLyraApi.request(createAiHistoryRequestPayload("thread/rename", {
          threadId,
          name
        }));
      }
      patchThreadName(threadId, name);
      cancelRenameThread();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRenamingThread(false);
    }
  }, [
    cancelRenameThread,
    desktopApi?.ai,
    editingThreadName,
    isRenamingThread,
    legacyLyraApi,
    patchThreadName
  ]);

  const requestDeleteThread = useCallback((thread: LyraThreadSummary): void => {
    const previewText = resolveThreadPreviewText(thread, threadPreviewEmptyLabel);
    if (openDialog === undefined) {
      void deleteThread(thread.id);
      return;
    }
    openDialog({
      title: deleteArchivedConversationTitle,
      description: deleteArchivedConversationDescription,
      source: {
        title: previewText,
        subtitle: thread.id,
        iconLabel: "DEL",
        iconTone: "danger"
      },
      actions: [
        {
          id: "ai-archive-delete-cancel",
          label: deleteArchivedConversationCancel
        },
        {
          id: "ai-archive-delete-confirm",
          label: deleteArchivedConversationConfirm,
          tone: "danger",
          onSelect: () => {
            void deleteThread(thread.id);
          }
        }
      ]
    });
  }, [
    deleteArchivedConversationCancel,
    deleteArchivedConversationConfirm,
    deleteArchivedConversationDescription,
    deleteArchivedConversationTitle,
    deleteThread,
    openDialog,
    threadPreviewEmptyLabel
  ]);

  const selectScope = useCallback((nextScope: HistoryScope): void => {
    setScope(nextScope);
    setSelectedProjectRoot(null);
  }, []);

  const selectProject = useCallback((projectRoot: string): void => {
    setSelectedProjectRoot(projectRoot);
  }, []);

  const clearSelectedProject = useCallback((): void => {
    setSelectedProjectRoot(null);
  }, []);

  const getThreadSummaryById = useCallback((threadId: string): LyraThreadSummary | null =>
    activeThreads.find((thread) => thread.id === threadId)
    ?? archivedThreads.find((thread) => thread.id === threadId)
    ?? null,
  [activeThreads, archivedThreads]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    const agentApi = desktopApi?.ai;
    if (agentApi === undefined) {
      return;
    }
    return agentApi.onAgentEvent((event: AgentRuntimeStreamEvent) => {
      if (event.eventType === "model_text_delta") {
        const payload = readRecord(event.payload);
        const delta = payload?.delta;
        if (typeof delta === "string" && event.runtimeTurnId !== undefined) {
          setLivePreviewByThread((current) => {
            const existing = current.get(event.sessionId);
            const next = new Map(current);
            const existingText =
              existing !== undefined && existing.turnId === event.runtimeTurnId
                ? existing.text
                : "";
            next.set(event.sessionId, {
              threadId: event.sessionId,
              turnId: event.runtimeTurnId!,
              text: `${existingText}${delta}`,
              updatedAt: Date.now()
            });
            return next;
          });
        }
      }
      if (
        event.eventType === "runtime_turn_completed"
        || event.eventType === "runtime_turn_cancelled"
        || event.eventType === "runtime_error"
      ) {
        setLivePreviewByThread((current) => {
          if (!current.has(event.sessionId)) {
            return current;
          }
          const next = new Map(current);
          next.delete(event.sessionId);
          return next;
        });
      }
      const detail = readDetailFromPayload(event.payload);
      if (detail !== null) {
        const summary = detailToThreadSummary(detail);
        setActiveThreads((current) => updateThreadBucket(current, summary));
        setPreviewDetail((current) => current?.session.id === detail.session.id ? detail : current);
      }
    });
  }, [desktopApi?.ai]);

  useEffect(() => {
    if (
      hasLoadedThreads === false ||
      isLoading ||
      activeThreadId !== null ||
      didAutoPreviewLatestRef.current ||
      latestThread === null
    ) {
      return;
    }
    didAutoPreviewLatestRef.current = true;
    setScope((current) =>
      current === "global" || current === "archivedGlobal"
        ? latestThread.archived ? "archivedGlobal" : "global"
        : current
    );
    void previewThread(latestThread.thread.id);
  }, [
    activeThreadId,
    hasLoadedThreads,
    isLoading,
    latestThread,
    previewThread
  ]);

  useEffect(() => {
    if (selectedProjectRoot === null || selectedProject !== null) {
      return;
    }
    setSelectedProjectRoot(null);
  }, [selectedProject, selectedProjectRoot]);

  return {
    lyraAvailable: desktopApi?.ai !== undefined || legacyLyraApi !== null,
    activeThreads,
    archivedThreads,
    threads,
    scope,
    selectedProjectRoot,
    selectedProject,
    projectGroups,
    activeProjectGroupCount: activeProjectGroups.length,
    archivedProjectGroupCount: archivedProjectGroups.length,
    activeThreadId,
    previewDetail,
    isPreviewLoading,
    previewError,
    livePreviewByThread,
    hasLoadedThreads,
    isLoading,
    editingThreadId,
    editingThreadName,
    isRenamingThread,
    errorMessage,
    isArchivedScope,
    isProjectScope,
    projectLogoByRoot,
    getThreadSummaryById,
    actions: {
      previewThread,
      openThread,
      archiveThread,
      unarchiveThread,
      requestDeleteThread,
      beginRenameThread,
      cancelRenameThread,
      submitRenameThread,
      setEditingThreadName,
      selectScope,
      selectProject,
      clearSelectedProject
    }
  };
};
