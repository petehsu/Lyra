import { Archive, ArrowLeft, Check, ExternalLink, FolderOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AgentSessionDetail } from "../../../shared/desktop-bridge";
import {
  StatusBadge,
  StatusEmptyState,
  StatusIndicator,
  type StatusTone,
} from "../ai-panel/status-primitives";
import {
  lyraThreadToAgentDetail,
  readLyraThread,
} from "../ai-panel/lyra-thread-adapter";
import { AiPanelRichContent } from "../ai-panel/rich-content";
import { emitThreadSelected } from "../thread-selection-events";
import { resolveAssistantDisplayContent } from "../ai-panel/view-helpers";
import type { AiHistorySurfaceProps } from "./types";

type JsonRecord = Record<string, unknown>;

type LyraThreadSummary = {
  readonly id: string;
  readonly name: string | null;
  readonly preview: string;
  readonly updatedAt: number | null;
  readonly modelProvider: string | null;
  readonly boundProjectRoot: string | null;
};

type HistoryScope = "global" | "project" | "archivedGlobal" | "archivedProject";

type ProjectGroup = {
  readonly projectRoot: string;
  readonly displayName: string;
  readonly threads: readonly LyraThreadSummary[];
};

type LivePreviewEntry = {
  readonly threadId: string;
  readonly turnId: string;
  readonly text: string;
  readonly updatedAt: number;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readPath = (value: unknown): string | null => {
  const direct = readString(value);
  if (direct !== null) {
    return direct;
  }
  if (isRecord(value)) {
    return readString(value.path) ?? readString(value.display);
  }
  return null;
};

const normalizeProjectRoot = (value: string): string => value.replace(/\\/g, "/").replace(/\/+$/g, "");

const projectDisplayName = (projectRoot: string): string => {
  const normalized = normalizeProjectRoot(projectRoot);
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? normalized;
};

const createRequestPayload = (
  method: string,
  params: JsonRecord
): Readonly<Record<string, unknown>> => ({
  method,
  params
});

const toThreadSummary = (value: unknown): LyraThreadSummary | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  if (id === null) {
    return null;
  }
  const rawUpdatedAt = readNumber(value.updatedAt);
  return {
    id,
    name: readString(value.name),
    preview: readString(value.preview) ?? "",
    updatedAt:
      rawUpdatedAt === null
        ? null
        : rawUpdatedAt < 10_000_000_000
          ? rawUpdatedAt * 1000
          : rawUpdatedAt,
    modelProvider: readString(value.modelProvider),
    boundProjectRoot: readPath(value.boundProjectRoot)
  };
};

const formatSessionTime = (timestampMs: number, locale: string): string => {
  try {
    return new Date(timestampMs).toLocaleString(locale);
  } catch (_error) {
    return String(timestampMs);
  }
};

const sortThreadsByRecency = (
  threads: readonly LyraThreadSummary[]
): readonly LyraThreadSummary[] =>
  [...threads].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));

const groupThreadsByProject = (
  threads: readonly LyraThreadSummary[]
): readonly ProjectGroup[] => {
  const buckets = new Map<string, LyraThreadSummary[]>();
  for (const thread of threads) {
    if (thread.boundProjectRoot === null) {
      continue;
    }
    const key = normalizeProjectRoot(thread.boundProjectRoot);
    if (key.length === 0) {
      continue;
    }
    const existing = buckets.get(key);
    if (existing === undefined) {
      buckets.set(key, [thread]);
    } else {
      existing.push(thread);
    }
  }
  const groups: ProjectGroup[] = [];
  for (const [projectRoot, bucket] of buckets) {
    groups.push({
      projectRoot,
      displayName: projectDisplayName(projectRoot),
      threads: sortThreadsByRecency(bucket)
    });
  }
  return groups.sort((left, right) => {
    const leftLatest = left.threads[0]?.updatedAt ?? 0;
    const rightLatest = right.threads[0]?.updatedAt ?? 0;
    return rightLatest - leftLatest;
  });
};

export const AiHistorySurface = ({
  desktopApi,
  locale,
  title,
  newSessionTitle,
  newConversationLabel,
  openConversationLabel,
  renameConversationLabel = "Rename conversation",
  deleteConversationLabel,
  archiveConversationLabel,
  archivedConversationLabel,
  archivedProjectLabel,
  deleteArchivedConversationTitle,
  deleteArchivedConversationDescription,
  deleteArchivedConversationConfirm,
  deleteArchivedConversationCancel,
  loadingSessionsLabel,
  emptyStateTitle,
  emptyStateDescription,
  scopeGlobalLabel,
  scopeProjectLabel,
  noProjectsEmptyLabel,
  projectSessionCountLabel,
  backToProjectsLabel,
  projectPathLabel,
  threadPreviewEmptyLabel,
  previewEmptyTitle,
  previewEmptyDescription,
  previewLoadingLabel,
  richRenderingEnabled = true,
  themeSignature,
  defaultProfileId: _defaultProfileId,
  defaultProviderId,
  openDialog
}: AiHistorySurfaceProps) => {
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
  const isArchivedScope = scope === "archivedGlobal" || scope === "archivedProject";
  const isProjectScope = scope === "project" || scope === "archivedProject";
  const threads = isArchivedScope ? archivedThreads : activeThreads;

  const loadThreads = useCallback(async (): Promise<void> => {
    if (lyraApi === undefined) {
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [activeResponse, archivedResponse] = await Promise.all([
        lyraApi.request<{ data?: readonly unknown[] }>(
          createRequestPayload("thread/list", {
            limit: 100,
            sortKey: "updated_at",
            sortDirection: "desc",
            archived: false,
            modelProviders: []
          })
        ),
        lyraApi.request<{ data?: readonly unknown[] }>(
          createRequestPayload("thread/list", {
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

  const patchThreadPreview = useCallback((threadId: string, preview: string, updatedAt: number): void => {
    const patch = (current: readonly LyraThreadSummary[]): readonly LyraThreadSummary[] =>
      sortThreadsByRecency(
        current.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                preview,
                updatedAt,
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
              title: name,
            },
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
      updatedAt,
    });
    if (text.trim().length > 0) {
      patchThreadPreview(threadId, text, updatedAt);
    }
  }, [patchThreadPreview, writeLivePreview]);

  useEffect(() => {
    if (lyraApi === undefined) {
      return;
    }
    void loadThreads();
  }, [lyraApi, loadThreads]);

  const projectGroups = useMemo(() => groupThreadsByProject(threads), [threads]);

  const selectedProject = useMemo<ProjectGroup | null>(() => {
    if (selectedProjectRoot === null) {
      return null;
    }
    return projectGroups.find((group) => group.projectRoot === selectedProjectRoot) ?? null;
  }, [projectGroups, selectedProjectRoot]);

  useEffect(() => {
    if (selectedProjectRoot === null || selectedProject !== null) {
      return;
    }
    setSelectedProjectRoot(null);
  }, [selectedProject, selectedProjectRoot]);

  const clearPreview = useCallback((): void => {
    previewRequestSeq.current += 1;
    setActiveThreadId(null);
    setPreviewDetail(null);
    setPreviewError(null);
    setIsPreviewLoading(false);
  }, []);

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
          createRequestPayload("thread/read", {
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
            updatedAt: Date.now(),
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
    writeLivePreview,
  ]);

  const createThread = useCallback(async (): Promise<void> => {
    if (lyraApi === undefined || isCreating) {
      return;
    }
    setIsCreating(true);
    setErrorMessage(null);
    try {
      const response = await lyraApi.request<{ thread?: unknown }>(
        createRequestPayload("thread/start", {
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
          createRequestPayload("thread/name/set", {
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
  }, [lyraApi, defaultProviderId, isCreating, loadThreads, newSessionTitle]);

  const archiveThread = useCallback(
    async (threadId: string): Promise<void> => {
      if (lyraApi === undefined) {
        return;
      }
      setErrorMessage(null);
      try {
        await lyraApi.request(
          createRequestPayload("thread/archive", {
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
          createRequestPayload("thread/delete", {
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
    setEditingThreadName(thread.name?.trim() || thread.preview.trim() || threadPreviewEmptyLabel);
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
        createRequestPayload("thread/name/set", {
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
    const previewText = thread.name?.trim() || thread.preview.trim() || threadPreviewEmptyLabel;
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

  const renderThreadRow = (thread: LyraThreadSummary) => {
    const previewText = thread.name?.trim() || thread.preview.trim() || threadPreviewEmptyLabel;
    const updatedAtMs = thread.updatedAt ?? Date.now();
    const tone: StatusTone =
      activeThreadId === thread.id
        ? "success"
        : threads[0]?.id === thread.id
          ? "info"
          : "muted";
    const rowClassName =
      activeThreadId === thread.id
        ? "lyra-ai-history-row lyra-ai-history-row-active"
        : "lyra-ai-history-row";
    if (editingThreadId === thread.id) {
      return (
        <form
          key={thread.id}
          className={`${rowClassName} lyra-ai-history-row-editing`}
          onSubmit={(event) => {
            event.preventDefault();
            void submitRenameThread(thread.id);
          }}
        >
          <label className="lyra-ai-history-row-edit">
            <input
              className="lyra-ai-history-row-edit-input"
              aria-label={renameConversationLabel}
              value={editingThreadName}
              autoFocus
              disabled={isRenamingThread}
              onChange={(event) => {
                setEditingThreadName(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelRenameThread();
                }
              }}
            />
          </label>
          <div className="lyra-ai-history-row-actions">
            <button
              type="submit"
              className="lyra-ai-history-row-action lyra-ai-history-row-action-open"
              disabled={isRenamingThread}
              aria-label={renameConversationLabel}
              title={renameConversationLabel}
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              className="lyra-ai-history-row-action"
              disabled={isRenamingThread}
              aria-label={deleteArchivedConversationCancel}
              title={deleteArchivedConversationCancel}
              onClick={cancelRenameThread}
            >
              <X size={14} />
            </button>
          </div>
        </form>
      );
    }
    return (
      <div key={thread.id} className={rowClassName}>
        <button
          type="button"
          className="lyra-ai-history-row-main"
          onClick={() => {
            void previewThread(thread.id);
          }}
        >
          <span className="lyra-ai-history-row-heading">
            <StatusIndicator
              tone={tone}
              variant="dot"
              ariaLabel={previewText}
            />
            <strong>{previewText}</strong>
          </span>
          <small>{formatSessionTime(updatedAtMs, locale)}</small>
        </button>
        <div className="lyra-ai-history-row-actions">
          <button
            type="button"
            className="lyra-ai-history-row-action lyra-ai-history-row-action-open"
            onClick={() => {
              beginRenameThread(thread);
            }}
            aria-label={renameConversationLabel}
            title={renameConversationLabel}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className="lyra-ai-history-row-action lyra-ai-history-row-action-open"
            onClick={() => {
              openThread(thread.id);
            }}
            aria-label={openConversationLabel}
            title={openConversationLabel}
          >
            <ExternalLink size={14} />
          </button>
          <button
            type="button"
            className="lyra-ai-history-row-action"
            onClick={() => {
              if (isArchivedScope) {
                requestDeleteThread(thread);
                return;
              }
              void archiveThread(thread.id);
            }}
            aria-label={isArchivedScope ? deleteConversationLabel : archiveConversationLabel}
            title={isArchivedScope ? deleteConversationLabel : archiveConversationLabel}
          >
            {isArchivedScope ? <Trash2 size={14} /> : <Archive size={14} />}
          </button>
        </div>
      </div>
    );
  };

  if (lyraApi === undefined) {
    return (
      <section className="lyra-ai-history-surface" aria-label={title}>
        <header className="lyra-ai-history-topbar">
          <div className="lyra-ai-history-topbar-title">{title}</div>
        </header>
        <StatusEmptyState
          title={emptyStateTitle}
          description={emptyStateDescription}
          className="lyra-ai-history-empty"
        />
      </section>
    );
  }

  const renderScopeBody = () => {
    if (!isProjectScope) {
      if (isLoading && threads.length === 0) {
        return (
          <StatusEmptyState
            title={loadingSessionsLabel}
            loading
            spinnerVariant="sand"
            tone="info"
            className="lyra-ai-history-empty-list"
          />
        );
      }
      if (threads.length === 0) {
        return (
          <StatusEmptyState
            title={emptyStateTitle}
            description={emptyStateDescription}
            className="lyra-ai-history-empty"
          />
        );
      }
      return (
        <div className="lyra-ai-history-rows">
          {threads.map(renderThreadRow)}
        </div>
      );
    }

    if (selectedProject !== null) {
      return (
        <div className="lyra-ai-history-project-detail">
          <div className="lyra-ai-history-project-detail-head">
            <button
              type="button"
              className="lyra-ai-history-back-button"
              onClick={() => {
                setSelectedProjectRoot(null);
                clearPreview();
              }}
            >
              <ArrowLeft size={14} />
              <span>{backToProjectsLabel}</span>
            </button>
            <div className="lyra-ai-history-project-detail-meta">
              <strong>{selectedProject.displayName}</strong>
              <span title={selectedProject.projectRoot}>
                {projectPathLabel}
                ：
                {selectedProject.projectRoot}
              </span>
            </div>
          </div>
          <div className="lyra-ai-history-rows">
            {selectedProject.threads.map(renderThreadRow)}
          </div>
        </div>
      );
    }

    if (isLoading && threads.length === 0) {
      return (
        <StatusEmptyState
          title={loadingSessionsLabel}
          loading
          spinnerVariant="sand"
          tone="info"
          className="lyra-ai-history-empty-list"
        />
      );
    }

    if (projectGroups.length === 0) {
      return (
        <StatusEmptyState
          title={noProjectsEmptyLabel}
          className="lyra-ai-history-empty"
        />
      );
    }

    return (
      <div className="lyra-ai-history-project-grid">
        {projectGroups.map((group) => (
          <button
            key={group.projectRoot}
            type="button"
            className={
              selectedProjectRoot === group.projectRoot
                ? "lyra-ai-history-project-card lyra-ai-history-project-card-active"
                : "lyra-ai-history-project-card"
            }
            onClick={() => {
              setSelectedProjectRoot(group.projectRoot);
              clearPreview();
            }}
          >
            <span className="lyra-ai-history-project-card-head">
              <StatusIndicator
                tone={selectedProjectRoot === group.projectRoot ? "success" : "info"}
                variant="bar"
                ariaLabel={group.displayName}
              />
            </span>
            <span className="lyra-ai-history-project-card-icon">
              <FolderOpen size={16} />
            </span>
            <span className="lyra-ai-history-project-card-main">
              <strong>{group.displayName}</strong>
              <small title={group.projectRoot}>{group.projectRoot}</small>
            </span>
            <StatusBadge
              tone={selectedProjectRoot === group.projectRoot ? "info" : "muted"}
              label={`${String(group.threads.length)} ${projectSessionCountLabel}`}
              className="lyra-ai-history-project-card-count"
            />
          </button>
        ))}
      </div>
    );
  };

  const renderPreviewPane = () => {
    if (isPreviewLoading) {
      return (
        <StatusEmptyState
          title={previewLoadingLabel}
          loading
          spinnerVariant="sand"
          tone="info"
          className="lyra-ai-history-preview-empty"
        />
      );
    }

    if (previewError !== null) {
      return (
        <div className="lyra-ai-history-preview-error">
          {previewError}
        </div>
      );
    }

    if (previewDetail === null) {
      return (
        <StatusEmptyState
          title={previewEmptyTitle}
          description={previewEmptyDescription}
          className="lyra-ai-history-preview-empty"
        />
      );
    }

    const livePreview = activeThreadId === null ? null : (livePreviewByThread.get(activeThreadId) ?? null);
    const sortedMessages = [...previewDetail.messages].sort((left, right) => left.createdAt - right.createdAt);
    const hasPersistedLivePreview =
      livePreview !== null
      && sortedMessages.some(
        (message) => message.role === "assistant" && message.turnId === livePreview.turnId
      );
    const displayMessages =
      livePreview !== null && livePreview.text.trim().length > 0 && !hasPersistedLivePreview
        ? [
            ...sortedMessages,
            {
              id: `live-preview:${livePreview.threadId}:${livePreview.turnId}`,
              sessionId: livePreview.threadId,
              turnId: livePreview.turnId,
              role: "assistant" as const,
              content: livePreview.text,
              displayContent: livePreview.text,
              createdAt: livePreview.updatedAt,
            },
          ]
        : sortedMessages;
    const updatedAtMs = previewDetail.session.updatedAt;
    return (
      <article className="lyra-ai-history-preview-card">
        <header className="lyra-ai-history-preview-head">
          <div className="lyra-ai-history-preview-title">
            <strong>{previewDetail.session.title || threadPreviewEmptyLabel}</strong>
            <small>{formatSessionTime(updatedAtMs, locale)}</small>
          </div>
          <div className="lyra-ai-history-preview-actions">
            <button
              type="button"
              className="lyra-ai-history-preview-open"
              onClick={() => {
                const sourceThread =
                  activeThreads.find((thread) => thread.id === previewDetail.session.id)
                  ?? archivedThreads.find((thread) => thread.id === previewDetail.session.id)
                  ?? null;
                beginRenameThread(sourceThread ?? {
                  id: previewDetail.session.id,
                  name: previewDetail.session.title,
                  preview: "",
                  updatedAt: previewDetail.session.updatedAt,
                  modelProvider: null,
                  boundProjectRoot: previewDetail.session.projectRoot ?? null,
                });
              }}
              aria-label={renameConversationLabel}
              title={renameConversationLabel}
            >
              <Pencil size={14} />
              <span>{renameConversationLabel}</span>
            </button>
            <button
              type="button"
              className="lyra-ai-history-preview-open"
              onClick={() => {
                openThread(previewDetail.session.id);
              }}
              aria-label={openConversationLabel}
              title={openConversationLabel}
            >
              <ExternalLink size={14} />
              <span>{openConversationLabel}</span>
            </button>
          </div>
        </header>
        {previewDetail.session.projectRoot === undefined ? null : (
          <div className="lyra-ai-history-preview-meta" title={previewDetail.session.projectRoot}>
            {projectPathLabel}
            ：
            {previewDetail.session.projectRoot}
          </div>
        )}
        {displayMessages.length === 0 ? (
          <StatusEmptyState
            title={threadPreviewEmptyLabel}
            className="lyra-ai-history-preview-empty"
          />
        ) : (
          <div className="lyra-ai-history-preview-messages">
            {displayMessages.map((message) => {
              const displayContent = message.role === "assistant"
                ? resolveAssistantDisplayContent(message)
                : message.content;
              return (
                <div
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "lyra-ai-history-preview-message lyra-ai-history-preview-message-user"
                      : "lyra-ai-history-preview-message lyra-ai-history-preview-message-assistant"
                  }
                >
                  <div className="lyra-ai-history-preview-message-content">
                    {message.role === "assistant" && richRenderingEnabled ? (
                      <AiPanelRichContent
                        content={displayContent}
                        locale={locale === "zh-CN" ? "zh-CN" : "en-US"}
                        {...(themeSignature === undefined ? {} : { themeSignature })}
                      />
                    ) : (
                      displayContent
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </article>
    );
  };

  return (
    <section className="lyra-ai-history-surface" aria-label={title}>
      <header className="lyra-ai-history-topbar">
        <div className="lyra-ai-history-topbar-title">{title}</div>
        <div className="lyra-ai-history-topbar-actions">
          <button
            type="button"
            className="lyra-ai-history-topbar-action"
            onClick={() => {
              void createThread();
            }}
            aria-label={newConversationLabel}
            title={newConversationLabel}
            disabled={isCreating}
          >
            <Plus size={14} />
          </button>
        </div>
      </header>

      <div className="lyra-ai-history-scope-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={scope === "global"}
          className={
            scope === "global"
              ? "lyra-ai-history-scope-tab lyra-ai-history-scope-tab-active"
              : "lyra-ai-history-scope-tab"
          }
          onClick={() => {
            setScope("global");
            setSelectedProjectRoot(null);
            clearPreview();
          }}
        >
          {scopeGlobalLabel}
          <small>{activeThreads.length}</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scope === "project"}
          className={
            scope === "project"
              ? "lyra-ai-history-scope-tab lyra-ai-history-scope-tab-active"
              : "lyra-ai-history-scope-tab"
          }
          onClick={() => {
            setScope("project");
            setSelectedProjectRoot(null);
            clearPreview();
          }}
        >
          {scopeProjectLabel}
          <small>{groupThreadsByProject(activeThreads).length}</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scope === "archivedGlobal"}
          className={
            scope === "archivedGlobal"
              ? "lyra-ai-history-scope-tab lyra-ai-history-scope-tab-active"
              : "lyra-ai-history-scope-tab"
          }
          onClick={() => {
            setScope("archivedGlobal");
            setSelectedProjectRoot(null);
            clearPreview();
          }}
        >
          {archivedConversationLabel}
          <small>{archivedThreads.length}</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scope === "archivedProject"}
          className={
            scope === "archivedProject"
              ? "lyra-ai-history-scope-tab lyra-ai-history-scope-tab-active"
              : "lyra-ai-history-scope-tab"
          }
          onClick={() => {
            setScope("archivedProject");
            setSelectedProjectRoot(null);
            clearPreview();
          }}
        >
          {archivedProjectLabel}
          <small>{groupThreadsByProject(archivedThreads).length}</small>
        </button>
      </div>

      <div className="lyra-ai-history-body">
        <div className="lyra-ai-history-list-pane">
          {renderScopeBody()}
          {errorMessage === null ? null : (
            <div className="lyra-ai-history-error">{errorMessage}</div>
          )}
        </div>
        <aside className="lyra-ai-history-preview-pane">
          {renderPreviewPane()}
        </aside>
      </div>
    </section>
  );
};
