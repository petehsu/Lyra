import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { emitThreadSelected } from "../thread-selection-events";
import type { AiHistorySurfaceProps } from "./types";

type JsonRecord = Record<string, unknown>;

type LyraThreadSummary = {
  readonly id: string;
  readonly name?: string | null;
  readonly preview: string;
  readonly updatedAt?: number | null;
  readonly modelProvider?: string | null;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

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

  return {
    id,
    name: readString(value.name),
    preview: readString(value.preview) ?? "",
    updatedAt: readNumber(value.updatedAt),
    modelProvider: readString(value.modelProvider)
  };
};

const formatSessionTime = (timestampMs: number, locale: string): string => {
  try {
    return new Date(timestampMs).toLocaleString(locale);
  } catch (_error) {
    return String(timestampMs);
  }
};

export const AiHistorySurface = ({
  desktopApi,
  locale,
  title,
  newSessionTitle,
  newConversationLabel,
  openConversationLabel,
  deleteConversationLabel,
  profileLabel,
  sessionIdLabel,
  loadingSessionsLabel,
  emptyStateTitle,
  emptyStateDescription,
  defaultProfileId: _defaultProfileId,
  defaultProviderId
}: AiHistorySurfaceProps) => {
  const lyraApi = desktopApi?.lyra;
  const [threads, setThreads] = useState<readonly LyraThreadSummary[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadThreads = useCallback(async (): Promise<void> => {
    if (lyraApi === undefined) {
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await lyraApi.request<{ data?: readonly unknown[] }>(
        createRequestPayload("thread/list", {
          limit: 100,
          sortKey: "updated_at",
          sortDirection: "desc",
          archived: false
        })
      );
      const listed = Array.isArray(response.data)
        ? response.data.map(toThreadSummary).filter((entry): entry is LyraThreadSummary => entry !== null)
        : [];
      setThreads(listed);
      setSelectedThreadId((current) => {
        if (current !== null && listed.some((thread) => thread.id === current)) {
          return current;
        }
        return listed[0]?.id ?? null;
      });
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
        || method === "thread/name/updated"
        || method === "turn/completed"
      ) {
        void loadThreads();
      }
    });
  }, [lyraApi, loadThreads]);

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
      await loadThreads();
      setSelectedThreadId(created.id);
      emitThreadSelected(created.id);
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
        const next = threads.filter((thread) => thread.id !== threadId);
        setThreads(next);
        const fallbackId = next[0]?.id ?? null;
        setSelectedThreadId((current) => {
          if (current !== threadId) {
            return current;
          }
          return fallbackId;
        });
        if (fallbackId !== null) {
          emitThreadSelected(fallbackId);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [lyraApi, threads]
  );

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [selectedThreadId, threads]
  );

  if (lyraApi === undefined) {
    return (
      <section className="lyra-ai-history-surface" aria-label={title}>
        <header className="lyra-ai-history-topbar">
          <div className="lyra-ai-history-topbar-title">{title}</div>
        </header>
        <div className="lyra-ai-history-empty">
          <strong>{emptyStateTitle}</strong>
          <span>{emptyStateDescription}</span>
        </div>
      </section>
    );
  }

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

      <div className="lyra-ai-history-shell">
        <aside className="lyra-ai-history-list-pane">
          {threads.length === 0 ? (
            <div className="lyra-ai-history-empty-list">
              {isLoading ? loadingSessionsLabel : emptyStateTitle}
            </div>
          ) : (
            <div className="lyra-ai-history-list">
              {threads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  className={
                    thread.id === selectedThreadId
                      ? "lyra-ai-history-item lyra-ai-history-item-active"
                      : "lyra-ai-history-item"
                  }
                  onClick={() => {
                    setSelectedThreadId(thread.id);
                  }}
                >
                  <strong>{thread.name?.trim() || thread.preview.trim() || thread.id}</strong>
                  <small>{formatSessionTime(thread.updatedAt ?? Date.now(), locale)}</small>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="lyra-ai-history-detail-pane">
          {selectedThread === null ? (
            <div className="lyra-ai-history-empty">
              <strong>{emptyStateTitle}</strong>
              <span>{emptyStateDescription}</span>
            </div>
          ) : (
            <div className="lyra-ai-history-detail-card">
              <header className="lyra-ai-history-detail-header">
                <strong>{selectedThread.name?.trim() || selectedThread.preview.trim() || selectedThread.id}</strong>
                <span>{formatSessionTime(selectedThread.updatedAt ?? Date.now(), locale)}</span>
              </header>
              <div className="lyra-ai-history-detail-meta">
                <div>
                  <span>{sessionIdLabel}</span>
                  <strong>{selectedThread.id}</strong>
                </div>
                <div>
                  <span>{profileLabel}</span>
                  <strong>{selectedThread.modelProvider ?? "-"}</strong>
                </div>
              </div>
              <div className="lyra-ai-history-detail-actions">
                <button
                  type="button"
                  className="lyra-ai-history-button"
                  onClick={() => {
                    emitThreadSelected(selectedThread.id);
                  }}
                >
                  <ArrowRight size={13} />
                  <span>{openConversationLabel}</span>
                </button>
                <button
                  type="button"
                  className="lyra-ai-history-button lyra-ai-history-button-danger"
                  onClick={() => {
                    void archiveThread(selectedThread.id);
                  }}
                >
                  <Trash2 size={13} />
                  <span>{deleteConversationLabel}</span>
                </button>
              </div>
            </div>
          )}
          {errorMessage === null ? null : (
            <div className="lyra-ai-history-error">{errorMessage}</div>
          )}
        </section>
      </div>
    </section>
  );
};
