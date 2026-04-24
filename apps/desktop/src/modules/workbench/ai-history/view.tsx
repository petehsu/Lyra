import { Archive, ArrowLeft, ExternalLink, FolderOpen, Plus, Trash2 } from "lucide-react";
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
import { emitThreadSelected } from "../thread-selection-events";
import type { AiHistorySurfaceProps } from "./types";

type JsonRecord = Record<string, unknown>;

type LyraThreadSummary = {
  readonly id: string;
  readonly name: string | null;
  readonly preview: string;
  readonly updatedAt: number | null;
  readonly modelProvider: string | null;
  readonly cwd: string | null;
};

type HistoryScope = "global" | "project" | "archivedGlobal" | "archivedProject";

type ProjectGroup = {
  readonly cwd: string;
  readonly displayName: string;
  readonly threads: readonly LyraThreadSummary[];
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readCwd = (value: unknown): string | null => {
  const direct = readString(value);
  if (direct !== null) {
    return direct;
  }
  if (isRecord(value)) {
    return readString(value.path) ?? readString(value.display);
  }
  return null;
};

const normalizeCwd = (value: string): string => value.replace(/\\/g, "/").replace(/\/+$/g, "");

const projectDisplayName = (cwd: string): string => {
  const normalized = normalizeCwd(cwd);
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
    cwd: readCwd(value.cwd)
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
    if (thread.cwd === null) {
      continue;
    }
    const key = normalizeCwd(thread.cwd);
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
  for (const [cwd, bucket] of buckets) {
    groups.push({
      cwd,
      displayName: projectDisplayName(cwd),
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
  defaultProfileId: _defaultProfileId,
  defaultProviderId,
  openDialog
}: AiHistorySurfaceProps) => {
  const lyraApi = desktopApi?.lyra;
  const [activeThreads, setActiveThreads] = useState<readonly LyraThreadSummary[]>([]);
  const [archivedThreads, setArchivedThreads] = useState<readonly LyraThreadSummary[]>([]);
  const [scope, setScope] = useState<HistoryScope>("global");
  const [selectedProjectCwd, setSelectedProjectCwd] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [previewDetail, setPreviewDetail] = useState<AgentSessionDetail | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const previewRequestSeq = useRef(0);
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

  useEffect(() => {
    if (lyraApi === undefined) {
      return;
    }
    void loadThreads();
  }, [lyraApi, loadThreads]);

  useEffect(() => {
    if (lyraApi === undefined) {
      return;
    }
    return lyraApi.onEvent((event) => {
      if (event.kind !== "notification" || !isRecord(event.notification)) {
        return;
      }
      const method = readString(event.notification.method);
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
    });
  }, [lyraApi, loadThreads]);

  const projectGroups = useMemo(() => groupThreadsByProject(threads), [threads]);

  const selectedProject = useMemo<ProjectGroup | null>(() => {
    if (selectedProjectCwd === null) {
      return null;
    }
    return projectGroups.find((group) => group.cwd === selectedProjectCwd) ?? null;
  }, [projectGroups, selectedProjectCwd]);

  useEffect(() => {
    if (selectedProjectCwd === null || selectedProject !== null) {
      return;
    }
    setSelectedProjectCwd(null);
  }, [selectedProject, selectedProjectCwd]);

  const clearPreview = useCallback((): void => {
    previewRequestSeq.current += 1;
    setActiveThreadId(null);
    setPreviewDetail(null);
    setPreviewError(null);
    setIsPreviewLoading(false);
  }, []);

  const previewThread = useCallback(
    async (threadId: string): Promise<void> => {
      if (lyraApi === undefined) {
        return;
      }
      const requestSeq = previewRequestSeq.current + 1;
      previewRequestSeq.current = requestSeq;
      setActiveThreadId(threadId);
      setPreviewDetail(null);
      setPreviewError(null);
      setIsPreviewLoading(true);
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
      } catch (error) {
        if (previewRequestSeq.current !== requestSeq) {
          return;
        }
        setPreviewError(error instanceof Error ? error.message : String(error));
      } finally {
        if (previewRequestSeq.current === requestSeq) {
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
                setSelectedProjectCwd(null);
                clearPreview();
              }}
            >
              <ArrowLeft size={14} />
              <span>{backToProjectsLabel}</span>
            </button>
            <div className="lyra-ai-history-project-detail-meta">
              <strong>{selectedProject.displayName}</strong>
              <span title={selectedProject.cwd}>
                {projectPathLabel}
                ：
                {selectedProject.cwd}
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
            key={group.cwd}
            type="button"
            className={
              selectedProjectCwd === group.cwd
                ? "lyra-ai-history-project-card lyra-ai-history-project-card-active"
                : "lyra-ai-history-project-card"
            }
            onClick={() => {
              setSelectedProjectCwd(group.cwd);
              clearPreview();
            }}
          >
            <span className="lyra-ai-history-project-card-head">
              <StatusIndicator
                tone={selectedProjectCwd === group.cwd ? "success" : "info"}
                variant="bar"
                ariaLabel={group.displayName}
              />
            </span>
            <span className="lyra-ai-history-project-card-icon">
              <FolderOpen size={16} />
            </span>
            <span className="lyra-ai-history-project-card-main">
              <strong>{group.displayName}</strong>
              <small title={group.cwd}>{group.cwd}</small>
            </span>
            <StatusBadge
              tone={selectedProjectCwd === group.cwd ? "info" : "muted"}
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

    const sortedMessages = [...previewDetail.messages].sort((left, right) => left.createdAt - right.createdAt);
    const updatedAtMs = previewDetail.session.updatedAt;
    return (
      <article className="lyra-ai-history-preview-card">
        <header className="lyra-ai-history-preview-head">
          <div className="lyra-ai-history-preview-title">
            <strong>{previewDetail.session.title || threadPreviewEmptyLabel}</strong>
            <small>{formatSessionTime(updatedAtMs, locale)}</small>
          </div>
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
        </header>
        {previewDetail.session.projectRoot === undefined ? null : (
          <div className="lyra-ai-history-preview-meta" title={previewDetail.session.projectRoot}>
            {projectPathLabel}
            ：
            {previewDetail.session.projectRoot}
          </div>
        )}
        {sortedMessages.length === 0 ? (
          <StatusEmptyState
            title={threadPreviewEmptyLabel}
            className="lyra-ai-history-preview-empty"
          />
        ) : (
          <div className="lyra-ai-history-preview-messages">
            {sortedMessages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "lyra-ai-history-preview-message lyra-ai-history-preview-message-user"
                    : "lyra-ai-history-preview-message lyra-ai-history-preview-message-assistant"
                }
              >
                <div className="lyra-ai-history-preview-message-content">
                  {"displayContent" in message && typeof message.displayContent === "string"
                    ? message.displayContent
                    : message.content}
                </div>
              </div>
            ))}
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
            setSelectedProjectCwd(null);
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
            setSelectedProjectCwd(null);
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
            setSelectedProjectCwd(null);
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
            setSelectedProjectCwd(null);
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
