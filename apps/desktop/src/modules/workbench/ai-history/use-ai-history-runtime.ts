import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AgentSessionDetail } from "../../../shared/desktop-bridge";
import {
  lyraThreadToAgentDetail,
  readLyraThread
} from "../ai-panel/lyra-thread-adapter";
import {
  normalizeProjectRoot,
  useProjectLogoMap
} from "../project-identity";
import { emitThreadSelected } from "../thread-selection-events";
import {
  createAiHistoryRequestPayload,
  groupThreadsByProject,
  isArchivedHistoryScope,
  isProjectHistoryScope,
  isRecord,
  readString,
  resolveThreadPreviewText,
  sortThreadsByRecency,
  toThreadSummary,
  type HistoryScope,
  type LivePreviewEntry,
  type LyraThreadSummary,
  type ProjectGroup
} from "./model";
import type { AiHistorySurfaceProps } from "./types";

type UseAiHistoryRuntimeOptions = {
  readonly desktopApi: AiHistorySurfaceProps["desktopApi"];
  readonly newSessionTitle: string;
  readonly defaultProviderId: string | null | undefined;
  readonly openDialog: AiHistorySurfaceProps["openDialog"] | undefined;
  readonly deleteArchivedConversationTitle: string;
  readonly deleteArchivedConversationDescription: string;
  readonly deleteArchivedConversationConfirm: string;
  readonly deleteArchivedConversationCancel: string;
  readonly threadPreviewEmptyLabel: string;
};

export type AiHistoryRuntimeActions = {
  readonly createThread: () => Promise<void>;
  readonly previewThread: (threadId: string, options?: { readonly silent?: boolean }) => Promise<void>;
  readonly openThread: (threadId: string) => void;
  readonly archiveThread: (threadId: string) => Promise<void>;
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
  readonly isLoading: boolean;
  readonly isCreating: boolean;
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
  newSessionTitle,
  defaultProviderId,
  openDialog,
  deleteArchivedConversationTitle,
  deleteArchivedConversationDescription,
  deleteArchivedConversationConfirm,
  deleteArchivedConversationCancel,
  threadPreviewEmptyLabel
}: UseAiHistoryRuntimeOptions): AiHistoryRuntime => {
  const lyraApi = desktopApi?.lyra;
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
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingThreadName, setEditingThreadName] = useState("");
  const [isRenamingThread, setIsRenamingThread] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const previewRequestSeq = useRef(0);
  const livePreviewByThreadRef = useRef<Map<string, LivePreviewEntry>>(new Map());
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

  const loadThreads = useCallback(async (): Promise<void> => {
    if (lyraApi === undefined) {
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [activeResponse, archivedResponse] = await Promise.all([
        lyraApi.request<{ data?: readonly unknown[] }>(
          createAiHistoryRequestPayload("thread/list", {
            limit: 100,
            sortKey: "updated_at",
            sortDirection: "desc",
            archived: false,
            modelProviders: []
          })
        ),
        lyraApi.request<{ data?: readonly unknown[] }>(
          createAiHistoryRequestPayload("thread/list", {
            limit: 100,
            sortKey: "updated_at",
            sortDirection: "desc",
            archived: true,
            modelProviders: []
          })
        )
      ]);
      const activeListed = Array.isArray(activeResponse.data)
        ? activeResponse.data
            .map(toThreadSummary)
            .filter((entry): entry is LyraThreadSummary => entry !== null)
        : [];
      const archivedListed = Array.isArray(archivedResponse.data)
        ? archivedResponse.data
            .map(toThreadSummary)
            .filter((entry): entry is LyraThreadSummary => entry !== null)
        : [];
      setActiveThreads(sortThreadsByRecency(activeListed));
      setArchivedThreads(sortThreadsByRecency(archivedListed));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [lyraApi]);

  const clearPreview = useCallback((): void => {
    previewRequestSeq.current += 1;
    setActiveThreadId(null);
    setPreviewDetail(null);
    setPreviewError(null);
    setIsPreviewLoading(false);
  }, []);

  const patchThreadPreview = useCallback((threadId: string, preview: string, updatedAt: number): void => {
    const patch = (current: readonly LyraThreadSummary[]): readonly LyraThreadSummary[] =>
      sortThreadsByRecency(
        current.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                preview,
                updatedAt
              }
            : thread
        )
      );
    setActiveThreads(patch);
    setArchivedThreads(patch);
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

  const writeLivePreview = useCallback((entry: LivePreviewEntry): void => {
    livePreviewByThreadRef.current.set(entry.threadId, entry);
    setLivePreviewByThread(new Map(livePreviewByThreadRef.current));
  }, []);

  const clearLivePreview = useCallback((threadId: string): void => {
    if (!livePreviewByThreadRef.current.delete(threadId)) {
      return;
    }
    setLivePreviewByThread(new Map(livePreviewByThreadRef.current));
  }, []);

  const appendLivePreview = useCallback((threadId: string, turnId: string, delta: string): void => {
    const previous = livePreviewByThreadRef.current.get(threadId);
    const text = `${previous?.turnId === turnId ? previous.text : ""}${delta}`;
    const updatedAt = Date.now();
    writeLivePreview({
      threadId,
      turnId,
      text,
      updatedAt
    });
    if (text.trim().length > 0) {
      patchThreadPreview(threadId, text, updatedAt);
    }
  }, [patchThreadPreview, writeLivePreview]);

  const previewThread = useCallback(
    async (threadId: string, options: { readonly silent?: boolean } = {}): Promise<void> => {
      if (lyraApi === undefined) {
        return;
      }
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
        const response = await lyraApi.request<{ thread?: unknown }>(
          createAiHistoryRequestPayload("thread/read", {
            threadId,
            includeTurns: true
          })
        );
        if (previewRequestSeq.current !== requestSeq) {
          return;
        }
        const thread = readLyraThread(response.thread);
        if (thread === null) {
          throw new Error("Lyra thread/read did not return a readable thread");
        }
        setPreviewDetail(lyraThreadToAgentDetail(thread));
        setPreviewError(null);
      } catch (error) {
        if (previewRequestSeq.current !== requestSeq) {
          return;
        }
        if (!silent) {
          setPreviewError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!silent && previewRequestSeq.current === requestSeq) {
          setIsPreviewLoading(false);
        }
      }
    },
    [lyraApi]
  );

  const createThread = useCallback(async (): Promise<void> => {
    if (lyraApi === undefined || isCreating) {
      return;
    }
    setIsCreating(true);
    setErrorMessage(null);
    try {
      const response = await lyraApi.request<{ thread?: unknown }>(
        createAiHistoryRequestPayload("thread/start", {
          ...(defaultProviderId === null || defaultProviderId === undefined
            ? {}
            : { modelProvider: defaultProviderId })
        })
      );
      const created = toThreadSummary(response.thread);
      if (created === null) {
        throw new Error("Lyra thread/start did not return a thread");
      }
      const normalizedName = newSessionTitle.trim();
      if (normalizedName.length > 0) {
        await lyraApi.request(
          createAiHistoryRequestPayload("thread/name/set", {
            threadId: created.id,
            name: normalizedName
          })
        );
      }
      emitThreadSelected(created.id);
      await loadThreads();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCreating(false);
    }
  }, [defaultProviderId, isCreating, loadThreads, lyraApi, newSessionTitle]);

  const archiveThread = useCallback(
    async (threadId: string): Promise<void> => {
      if (lyraApi === undefined) {
        return;
      }
      setErrorMessage(null);
      try {
        await lyraApi.request(
          createAiHistoryRequestPayload("thread/archive", {
            threadId
          })
        );
        if (activeThreadId === threadId) {
          clearPreview();
        }
        setActiveThreads((current) => current.filter((thread) => thread.id !== threadId));
        void loadThreads();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [activeThreadId, clearPreview, loadThreads, lyraApi]
  );

  const deleteThread = useCallback(
    async (threadId: string): Promise<void> => {
      if (lyraApi === undefined) {
        return;
      }
      setErrorMessage(null);
      try {
        await lyraApi.request(
          createAiHistoryRequestPayload("thread/delete", {
            threadId
          })
        );
        if (activeThreadId === threadId) {
          clearPreview();
        }
        setActiveThreads((current) => current.filter((thread) => thread.id !== threadId));
        setArchivedThreads((current) => current.filter((thread) => thread.id !== threadId));
        void loadThreads();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [activeThreadId, clearPreview, loadThreads, lyraApi]
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
    if (lyraApi === undefined || isRenamingThread) {
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
      await lyraApi.request(
        createAiHistoryRequestPayload("thread/name/set", {
          threadId,
          name
        })
      );
      patchThreadName(threadId, name);
      cancelRenameThread();
      void loadThreads();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRenamingThread(false);
    }
  }, [
    cancelRenameThread,
    editingThreadName,
    isRenamingThread,
    loadThreads,
    lyraApi,
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
    clearPreview();
  }, [clearPreview]);

  const selectProject = useCallback((projectRoot: string): void => {
    setSelectedProjectRoot(projectRoot);
    clearPreview();
  }, [clearPreview]);

  const clearSelectedProject = useCallback((): void => {
    setSelectedProjectRoot(null);
    clearPreview();
  }, [clearPreview]);

  const getThreadSummaryById = useCallback((threadId: string): LyraThreadSummary | null =>
    activeThreads.find((thread) => thread.id === threadId)
    ?? archivedThreads.find((thread) => thread.id === threadId)
    ?? null,
  [activeThreads, archivedThreads]);

  useEffect(() => {
    if (lyraApi === undefined) {
      return;
    }
    void loadThreads();
  }, [lyraApi, loadThreads]);

  useEffect(() => {
    if (selectedProjectRoot === null || selectedProject !== null) {
      return;
    }
    setSelectedProjectRoot(null);
  }, [selectedProject, selectedProjectRoot]);

  useEffect(() => {
    if (lyraApi === undefined) {
      return;
    }
    return lyraApi.onEvent((event) => {
      if (event.kind !== "notification" || !isRecord(event.notification)) {
        return;
      }
      const method = readString(event.notification.method);
      const params = isRecord(event.notification.params) ? event.notification.params : {};
      if (
        method === "thread/started"
        || method === "thread/archived"
        || method === "thread/deleted"
        || method === "thread/unarchived"
        || method === "thread/name/updated"
        || method === "turn/completed"
      ) {
        void loadThreads();
      }
      if (method === "thread/deleted" || method === "thread/archived") {
        const threadId = readString(params.threadId);
        if (threadId !== null) {
          clearLivePreview(threadId);
        }
        return;
      }
      if (method === "turn/started") {
        const threadId = readString(params.threadId);
        const turn = isRecord(params.turn) ? params.turn : null;
        const turnId = turn === null ? null : readString(turn.id);
        if (threadId !== null && turnId !== null) {
          writeLivePreview({
            threadId,
            turnId,
            text: "",
            updatedAt: Date.now()
          });
        }
        return;
      }
      if (method === "item/agentMessage/delta") {
        const threadId = readString(params.threadId);
        const turnId = readString(params.turnId);
        const delta = typeof params.delta === "string" ? params.delta : "";
        if (threadId !== null && turnId !== null && delta.length > 0) {
          appendLivePreview(threadId, turnId, delta);
        }
        return;
      }
      if (method === "item/completed" || method === "turn/completed") {
        const threadId = readString(params.threadId);
        if (threadId !== null && threadId === activeThreadId) {
          void previewThread(threadId, { silent: true }).finally(() => {
            clearLivePreview(threadId);
          });
        }
      }
    });
  }, [
    activeThreadId,
    appendLivePreview,
    clearLivePreview,
    loadThreads,
    lyraApi,
    previewThread,
    writeLivePreview
  ]);

  return {
    lyraAvailable: lyraApi !== undefined,
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
    isLoading,
    isCreating,
    editingThreadId,
    editingThreadName,
    isRenamingThread,
    errorMessage,
    isArchivedScope,
    isProjectScope,
    projectLogoByRoot,
    getThreadSummaryById,
    actions: {
      createThread,
      previewThread,
      openThread,
      archiveThread,
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
