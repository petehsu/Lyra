import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Bot,
  Check,
  Clock3,
  Folder,
  History,
  MessageSquare,
  PanelLeftOpen,
  Pencil,
  RefreshCw,
  Search,
  Star,
  StarOff,
  Trash2,
  X
} from "lucide-react";

import "../ai-panel/agent-chat-demo/App.css";
import "../ai-panel/agent-chat-demo/styles/tokens.css";
import { setLocale } from "../ai-panel/agent-chat-demo/core/i18n";
import { DataContextProvider } from "../ai-panel/agent-chat-demo/data/DataProvider";
import { createDataProviderValue } from "../ai-panel/agent-chat-demo/data/createDataProviderValue";
import { Message } from "../ai-panel/agent-chat-demo/features/chat/Message";
import {
  agentSessionToChatMessages,
  agentSessionToSessionMeta,
  applyAgentRuntimeEventToSnapshot
} from "../agent-session-view-model";
import type {
  AgentSessionSnapshot,
  AgentSessionSummary
} from "../../../shared/desktop-bridge";
import type {
  AgentSessionHistoryPreviewState,
  AgentSessionHistoryState,
  AgentSessionHistorySurfaceProps
} from "./types";

const EMPTY_STATE: AgentSessionHistoryState = {
  sessionsDir: null,
  sessions: []
};

const EMPTY_PREVIEW_STATE: AgentSessionHistoryPreviewState = {
  sessionId: null,
  snapshot: null
};

const normalize = (value: string): string => value.trim().toLocaleLowerCase();

const formatSessionTime = (value?: string | null): string => {
  if (value === undefined || value === null || value.trim().length === 0) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(parsed);
};

const sessionSearchText = (session: AgentSessionSummary): string =>
  normalize([
    session.title,
    session.customTitle,
    session.saveLabel,
    session.shortName,
    session.status,
    session.providerLabel,
    session.providerKey,
    session.model,
    session.workingDir
  ].filter(Boolean).join(" "));

const filterSessions = (
  sessions: readonly AgentSessionSummary[],
  query: string
): readonly AgentSessionSummary[] => {
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length === 0) {
    return sessions;
  }
  return sessions.filter((session) => sessionSearchText(session).includes(normalizedQuery));
};

type SessionGroups = {
  readonly saved: readonly AgentSessionSummary[];
  readonly recent: readonly AgentSessionSummary[];
  readonly archived: readonly AgentSessionSummary[];
};

const groupSessions = (sessions: readonly AgentSessionSummary[]): SessionGroups => ({
  saved: sessions.filter((session) => session.saved && !session.archived),
  recent: sessions.filter((session) => !session.saved && !session.archived),
  archived: sessions.filter((session) => session.archived)
});

const SessionRow = ({
  session,
  labels,
  active,
  selected,
  opening,
  busy,
  onPreview,
  onOpenInAiPanel,
  onToggleSaved,
  onToggleArchived,
  onRename,
  onDelete
}: {
  readonly session: AgentSessionSummary;
  readonly labels: AgentSessionHistorySurfaceProps["labels"];
  readonly active: boolean;
  readonly selected: boolean;
  readonly opening: boolean;
  readonly busy: boolean;
  readonly onPreview: (sessionId: string) => void;
  readonly onOpenInAiPanel: (sessionId: string) => void;
  readonly onToggleSaved: (session: AgentSessionSummary) => void;
  readonly onToggleArchived: (session: AgentSessionSummary) => void;
  readonly onRename: (session: AgentSessionSummary) => void;
  readonly onDelete: (session: AgentSessionSummary) => void;
}) => {
  const updatedAt = formatSessionTime(session.lastActiveAt ?? session.updatedAt);
  const modelLabel = session.model ?? labels.modelFallback;
  const providerLabel = session.providerLabel ?? labels.statusFallback;
  const workingDir = session.workingDir ?? "";
  const disabled = opening || busy;

  return (
    <article
      className={
        [
          "lyra-agent-history-row",
          active ? "lyra-agent-history-row-active" : "",
          selected ? "lyra-agent-history-row-selected" : ""
        ].filter(Boolean).join(" ")
      }
    >
      <span className="lyra-agent-history-row-icon" aria-hidden="true">
        {session.saved ? <Star size={14} /> : session.archived ? <Archive size={14} /> : <History size={14} />}
      </span>
      <button
        type="button"
        className="lyra-agent-history-row-open"
        aria-label={`${labels.previewTitle}: ${session.title}`}
        disabled={disabled}
        onClick={() => onPreview(session.id)}
      >
        <span className="lyra-agent-history-row-main">
          <span className="lyra-agent-history-row-title">
            <strong title={session.title}>{session.title}</strong>
            <span className="lyra-agent-history-row-status">
              {session.archived ? labels.groupArchived : session.saved ? labels.saved : session.status}
            </span>
          </span>
          <span className="lyra-agent-history-row-model" title={`${providerLabel} / ${modelLabel}`}>
            <Bot size={12} aria-hidden="true" />
            <span>{providerLabel} / {modelLabel}</span>
          </span>
          <span className="lyra-agent-history-row-facts">
            <span title={`${session.messageCount} ${labels.messages}`}>
              <MessageSquare size={12} aria-hidden="true" />
              <span>{session.messageCount} {labels.messages}</span>
            </span>
            {updatedAt.length === 0 ? null : (
              <span title={`${labels.updated} ${updatedAt}`}>
                <Clock3 size={12} aria-hidden="true" />
                <span>{updatedAt}</span>
              </span>
            )}
          </span>
          {workingDir.length === 0 ? null : (
            <span className="lyra-agent-history-row-path" title={`${labels.workingDir}: ${workingDir}`}>
              <Folder size={12} aria-hidden="true" />
              <span>{workingDir}</span>
            </span>
          )}
        </span>
      </button>
      <span className="lyra-agent-history-row-actions">
        <button
          type="button"
          className="lyra-agent-history-row-action lyra-agent-history-row-action-open-ai"
          aria-label={`${labels.openInAiPanel}: ${session.title}`}
          title={labels.openInAiPanel}
          disabled={busy}
          onClick={() => onOpenInAiPanel(session.id)}
        >
          <PanelLeftOpen size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="lyra-agent-history-row-action"
          aria-label={`${session.saved ? labels.unsaved : labels.saved}: ${session.title}`}
          title={session.saved ? labels.unsaved : labels.saved}
          disabled={disabled}
          onClick={() => onToggleSaved(session)}
        >
          {session.saved ? <StarOff size={14} aria-hidden="true" /> : <Star size={14} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="lyra-agent-history-row-action"
          aria-label={`${session.archived ? labels.unarchive : labels.archive}: ${session.title}`}
          title={session.archived ? labels.unarchive : labels.archive}
          disabled={disabled}
          onClick={() => onToggleArchived(session)}
        >
          <Archive size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="lyra-agent-history-row-action"
          aria-label={`${labels.rename}: ${session.title}`}
          title={labels.rename}
          disabled={disabled}
          onClick={() => onRename(session)}
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="lyra-agent-history-row-action lyra-agent-history-row-action-danger"
          aria-label={`${labels.delete}: ${session.title}`}
          title={labels.delete}
          disabled={disabled}
          onClick={() => onDelete(session)}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </span>
    </article>
  );
};

const AgentSessionPreviewPane = ({
  snapshot,
  summary,
  labels,
  loading
}: {
  readonly snapshot: AgentSessionSnapshot | null;
  readonly summary: AgentSessionSummary | null;
  readonly labels: AgentSessionHistorySurfaceProps["labels"];
  readonly loading: boolean;
}) => {
  if (loading) {
    return (
      <aside className="lyra-agent-history-preview" aria-label={labels.previewTitle}>
        <div className="lyra-agent-history-preview-state">{labels.loading}</div>
      </aside>
    );
  }

  if (snapshot === null) {
    return (
      <aside className="lyra-agent-history-preview" aria-label={labels.previewTitle}>
        <div className="lyra-agent-history-preview-empty">
          <History size={22} aria-hidden="true" />
          <strong>{labels.previewEmptyTitle}</strong>
          <span>{labels.previewEmptyDescription}</span>
        </div>
      </aside>
    );
  }

  const updatedAt = formatSessionTime(summary?.lastActiveAt ?? summary?.updatedAt ?? snapshot.updatedAt);
  const modelLabel = summary?.model ?? labels.modelFallback;
  const providerLabel = summary?.providerLabel ?? labels.statusFallback;
  const workingDir = summary?.workingDir ?? "";
  const messages = agentSessionToChatMessages(snapshot);
  const previewData = createDataProviderValue({
    session: agentSessionToSessionMeta(snapshot),
    messages,
    isMock: false,
    isTurnRunning: false
  });

  return (
    <aside className="lyra-agent-history-preview" aria-label={labels.previewTitle}>
      <header className="lyra-agent-history-preview-header">
        <div>
          <span className="lyra-agent-history-preview-kicker">{labels.previewTitle}</span>
          <h3>{snapshot.title}</h3>
        </div>
        <span className="lyra-agent-history-preview-status">
          {summary?.archived ? labels.groupArchived : summary?.saved ? labels.saved : snapshot.turnStatus}
        </span>
      </header>
      <div className="lyra-agent-history-preview-meta">
        <span>
          <Bot size={12} aria-hidden="true" />
          {providerLabel} / {modelLabel}
        </span>
        <span>
          <MessageSquare size={12} aria-hidden="true" />
          {summary?.messageCount ?? snapshot.messages.length} {labels.messages}
        </span>
        {updatedAt.length === 0 ? null : (
          <span>
            <Clock3 size={12} aria-hidden="true" />
            {labels.updated} {updatedAt}
          </span>
        )}
        {workingDir.length === 0 ? null : (
          <span className="lyra-agent-history-preview-path">
            <Folder size={12} aria-hidden="true" />
            {workingDir}
          </span>
        )}
      </div>
      <div className="lyra-agent-history-preview-chat" role="log">
        {messages.length === 0 ? (
          <div className="lyra-agent-history-preview-empty lyra-agent-history-preview-empty-inline">
            <strong>{labels.emptyTitle}</strong>
            <span>{labels.emptyDescription}</span>
          </div>
        ) : (
          <DataContextProvider value={previewData}>
            {messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}
          </DataContextProvider>
        )}
      </div>
    </aside>
  );
};

export const AgentSessionHistorySurface = ({
  desktopApi,
  labels,
  activeSessionId = null,
  onOpenSession,
  locale
}: AgentSessionHistorySurfaceProps) => {
  if (locale !== undefined) {
    setLocale(locale);
  }

  const [state, setState] = useState<AgentSessionHistoryState>(EMPTY_STATE);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null);
  const [preview, setPreview] = useState<AgentSessionHistoryPreviewState>(EMPTY_PREVIEW_STATE);
  const [operationSessionId, setOperationSessionId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<AgentSessionSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AgentSessionSummary | null>(null);

  const loadSessions = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) {
      setState(EMPTY_STATE);
      setErrorMessage(labels.runtimeUnavailable);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await desktopApi.agent.listSessions({ limit: 500 });
      setState({
        sessionsDir: response.sessionsDir,
        sessions: response.sessions
      });
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [desktopApi, labels.runtimeUnavailable]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    const agentApi = desktopApi?.agent;
    if (agentApi === undefined) return undefined;
    return agentApi.onEvent((event) => {
      setPreview((current) => {
        if (current.snapshot === null) return current;
        if (event.kind === "sessionSnapshot") {
          if (event.snapshot.id !== current.sessionId) return current;
          return {
            sessionId: event.snapshot.id,
            snapshot: event.snapshot
          };
        }
        if ("sessionId" in event && event.sessionId !== current.sessionId) {
          return current;
        }
        return {
          ...current,
          snapshot: applyAgentRuntimeEventToSnapshot(current.snapshot, event)
        };
      });
    });
  }, [desktopApi]);

  const filteredSessions = useMemo(
    () => filterSessions(state.sessions, query),
    [query, state.sessions]
  );
  const groupedSessions = useMemo(
    () => groupSessions(filteredSessions),
    [filteredSessions]
  );

  const previewSession = useCallback(async (sessionId: string): Promise<void> => {
    if (desktopApi?.agent === undefined) {
      setErrorMessage(labels.runtimeUnavailable);
      return;
    }
    setOpeningSessionId(sessionId);
    setPreview((current) => ({
      sessionId,
      snapshot: current.sessionId === sessionId ? current.snapshot : null
    }));
    try {
      const snapshot = await desktopApi.agent.readSession({ sessionId });
      setPreview((current) =>
        current.sessionId === sessionId
          ? { sessionId, snapshot }
          : current
      );
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningSessionId(null);
    }
  }, [desktopApi, labels.runtimeUnavailable]);

  const openInAiPanel = useCallback(async (sessionId: string): Promise<void> => {
    await onOpenSession(sessionId);
  }, [onOpenSession]);

  const refreshAfterMutation = useCallback(async (): Promise<void> => {
    await loadSessions();
  }, [loadSessions]);

  const runSessionAction = useCallback(async (
    sessionId: string,
    action: () => Promise<void>
  ): Promise<void> => {
    setOperationSessionId(sessionId);
    try {
      await action();
      await refreshAfterMutation();
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationSessionId(null);
    }
  }, [refreshAfterMutation]);

  const toggleSaved = useCallback((session: AgentSessionSummary): void => {
    const agentApi = desktopApi?.agent;
    if (agentApi === undefined) {
      setErrorMessage(labels.runtimeUnavailable);
      return;
    }
    void runSessionAction(session.id, async () => {
      if (session.saved) {
        await agentApi.unsaveSession({ sessionId: session.id });
      } else {
        await agentApi.saveSession({ sessionId: session.id, label: null });
      }
    });
  }, [desktopApi, labels.runtimeUnavailable, runSessionAction]);

  const toggleArchived = useCallback((session: AgentSessionSummary): void => {
    const agentApi = desktopApi?.agent;
    if (agentApi === undefined) {
      setErrorMessage(labels.runtimeUnavailable);
      return;
    }
    void runSessionAction(session.id, async () => {
      await agentApi.archiveSession({
        sessionId: session.id,
        archived: !session.archived
      });
    });
  }, [desktopApi, labels.runtimeUnavailable, runSessionAction]);

  const openRenameDialog = useCallback((session: AgentSessionSummary): void => {
    setRenameTarget(session);
    setRenameValue(session.customTitle ?? session.title);
  }, []);

  const submitRename = useCallback(async (title: string | null): Promise<void> => {
    const agentApi = desktopApi?.agent;
    if (agentApi === undefined || renameTarget === null) {
      setErrorMessage(labels.runtimeUnavailable);
      return;
    }
    const sessionId = renameTarget.id;
    await runSessionAction(sessionId, async () => {
      await agentApi.renameSession({ sessionId, title });
    });
    setRenameTarget(null);
    setRenameValue("");
  }, [desktopApi, labels.runtimeUnavailable, renameTarget, runSessionAction]);

  const confirmDelete = useCallback(async (): Promise<void> => {
    const agentApi = desktopApi?.agent;
    if (agentApi === undefined || deleteTarget === null) {
      setErrorMessage(labels.runtimeUnavailable);
      return;
    }
    const sessionId = deleteTarget.id;
    await runSessionAction(sessionId, async () => {
      await agentApi.deleteSession({ sessionId });
      setPreview((current) =>
        current.sessionId === sessionId ? EMPTY_PREVIEW_STATE : current
      );
      if (activeSessionId === sessionId) {
        const snapshot = await agentApi.createSession({ title: "Lyra Agent" });
        await onOpenSession(snapshot.id);
      }
    });
    setDeleteTarget(null);
  }, [
    activeSessionId,
    deleteTarget,
    desktopApi,
    labels.runtimeUnavailable,
    onOpenSession,
    runSessionAction
  ]);

  const renderGroup = (
    id: keyof SessionGroups,
    title: string,
    sessions: readonly AgentSessionSummary[]
  ) => {
    if (sessions.length === 0) return null;
    return (
      <section className="lyra-agent-history-group" aria-labelledby={`agent-history-${id}`}>
        <h3 id={`agent-history-${id}`}>
          <span>{title}</span>
          <span>{sessions.length}</span>
        </h3>
        <div className="lyra-agent-history-group-list">
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              labels={labels}
              active={activeSessionId === session.id}
              selected={preview.sessionId === session.id}
              opening={openingSessionId === session.id}
              busy={operationSessionId === session.id}
              onPreview={(sessionId) => {
                void previewSession(sessionId);
              }}
              onOpenInAiPanel={(sessionId) => {
                void openInAiPanel(sessionId);
              }}
              onToggleSaved={toggleSaved}
              onToggleArchived={toggleArchived}
              onRename={openRenameDialog}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      </section>
    );
  };

  const previewSummary = preview.sessionId === null
    ? null
    : state.sessions.find((session) => session.id === preview.sessionId) ?? null;

  return (
    <section className="lyra-agent-history" aria-label={labels.title}>
      <header className="lyra-agent-history-header">
        <div className="lyra-agent-history-heading">
          <span className="lyra-agent-history-heading-icon" aria-hidden="true">
            <History size={16} />
          </span>
          <div>
            <h2>{labels.title}</h2>
            {state.sessionsDir === null ? null : (
              <p>{state.sessionsDir}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          className="lyra-agent-history-refresh"
          disabled={loading}
          onClick={() => {
            void loadSessions();
          }}
        >
          <RefreshCw size={14} aria-hidden="true" />
          <span>{labels.refresh}</span>
        </button>
      </header>

      {errorMessage === null ? null : (
        <div className="lyra-agent-history-error" role="status">
          <strong>{labels.errorTitle}</strong>
          <span>{errorMessage}</span>
        </div>
      )}

      <section className="lyra-agent-history-split">
        <section className="lyra-agent-history-list" aria-busy={loading}>
          <div className="lyra-agent-history-list-controls">
            <label className="lyra-agent-history-search">
              <Search size={14} aria-hidden="true" />
              <input
                value={query}
                placeholder={labels.searchPlaceholder}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <span className="lyra-agent-history-count">
              {filteredSessions.length} / {state.sessions.length}
            </span>
          </div>
          <div className="lyra-agent-history-list-content">
            {loading ? (
              <div className="lyra-agent-history-state">{labels.loading}</div>
            ) : filteredSessions.length === 0 ? (
              <div className="lyra-agent-history-state">
                <strong>{labels.emptyTitle}</strong>
                <span>{labels.emptyDescription}</span>
              </div>
            ) : (
              <>
                {renderGroup("saved", labels.groupSaved, groupedSessions.saved)}
                {renderGroup("recent", labels.groupRecent, groupedSessions.recent)}
                {renderGroup("archived", labels.groupArchived, groupedSessions.archived)}
              </>
            )}
          </div>
        </section>
        <AgentSessionPreviewPane
          snapshot={preview.snapshot}
          summary={previewSummary}
          labels={labels}
          loading={openingSessionId !== null && preview.sessionId === openingSessionId}
        />
      </section>

      {renameTarget === null ? null : (
        <div className="lyra-agent-history-dialog-backdrop" role="presentation">
          <form
            className="lyra-agent-history-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={labels.renameTitle}
            onSubmit={(event) => {
              event.preventDefault();
              void submitRename(renameValue.trim().length === 0 ? null : renameValue);
            }}
          >
            <header>
              <strong>{labels.renameTitle}</strong>
              <button
                type="button"
                aria-label={labels.cancelAction}
                onClick={() => setRenameTarget(null)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </header>
            <input
              autoFocus
              value={renameValue}
              placeholder={labels.renamePlaceholder}
              onChange={(event) => setRenameValue(event.currentTarget.value)}
            />
            <footer>
              <button type="button" onClick={() => void submitRename(null)}>
                {labels.clearRename}
              </button>
              <button type="button" onClick={() => setRenameTarget(null)}>
                {labels.cancelAction}
              </button>
              <button type="submit" className="lyra-agent-history-dialog-primary">
                <Check size={14} aria-hidden="true" />
                {labels.saveRename}
              </button>
            </footer>
          </form>
        </div>
      )}

      {deleteTarget === null ? null : (
        <div className="lyra-agent-history-dialog-backdrop" role="presentation">
          <section
            className="lyra-agent-history-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={labels.deleteConfirmTitle}
          >
            <header>
              <strong>{labels.deleteConfirmTitle}</strong>
              <button
                type="button"
                aria-label={labels.cancelAction}
                onClick={() => setDeleteTarget(null)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </header>
            <p>{labels.deleteConfirmDescription}</p>
            <footer>
              <button type="button" onClick={() => setDeleteTarget(null)}>
                {labels.cancelAction}
              </button>
              <button
                type="button"
                className="lyra-agent-history-dialog-danger"
                onClick={() => void confirmDelete()}
              >
                <Trash2 size={14} aria-hidden="true" />
                {labels.deleteConfirmAction}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
};
