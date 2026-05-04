import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AgentSessionDetail } from "../ai-panel/agent-ui-types";
import {
  normalizeProjectRoot,
  useProjectLogoMap
} from "../project-identity";
import { emitThreadSelected } from "../thread-selection-events";
import {
  groupThreadsByProject,
  isArchivedHistoryScope,
  isProjectHistoryScope,
  resolveThreadPreviewText,
  type HistoryScope,
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
    setErrorMessage(null);
    setIsLoading(false);
    setHasLoadedThreads(true);
    setActiveThreads([]);
    setArchivedThreads([]);
  }, []);

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
      const silent = options.silent === true;
      const requestSeq = previewRequestSeq.current + 1;
      previewRequestSeq.current = requestSeq;
      setActiveThreadId(threadId);
      if (!silent) {
        setPreviewDetail(null);
        setPreviewError(null);
        setIsPreviewLoading(true);
      }
      if (previewRequestSeq.current !== requestSeq) {
        return;
      }
      setPreviewDetail(null);
      setPreviewError(null);
      if (!silent) {
        setIsPreviewLoading(false);
      }
    },
    []
  );

  const archiveThread = useCallback(
    async (threadId: string): Promise<void> => {
      setErrorMessage(null);
      if (activeThreadId === threadId) {
        clearPreview();
      }
      setActiveThreads((current) => current.filter((thread) => thread.id !== threadId));
    },
    [activeThreadId, clearPreview]
  );

  const unarchiveThread = useCallback(
    async (threadId: string): Promise<void> => {
      setErrorMessage(null);
      if (activeThreadId === threadId) {
        clearPreview();
      }
      setArchivedThreads((current) => current.filter((thread) => thread.id !== threadId));
    },
    [activeThreadId, clearPreview]
  );

  const deleteThread = useCallback(
    async (threadId: string): Promise<void> => {
      setErrorMessage(null);
      if (activeThreadId === threadId) {
        clearPreview();
      }
      setActiveThreads((current) => current.filter((thread) => thread.id !== threadId));
      setArchivedThreads((current) => current.filter((thread) => thread.id !== threadId));
    },
    [activeThreadId, clearPreview]
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
    patchThreadName(threadId, name);
    cancelRenameThread();
    setIsRenamingThread(false);
  }, [
    cancelRenameThread,
    editingThreadName,
    isRenamingThread,
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
    if (
      hasLoadedThreads === false ||
      isLoading ||
      activeThreadId !== null ||
      latestThread === null
    ) {
      return;
    }
    setScope(latestThread.archived ? "archivedGlobal" : "global");
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
    lyraAvailable: false,
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
