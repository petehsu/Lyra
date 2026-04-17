import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { AgentSession } from "../../../shared/desktop-bridge";
import { emitAgentSessionSelected } from "../agent-session-events";
import type { AiHistorySurfaceProps } from "./types";

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
  defaultProfileId
}: AiHistorySurfaceProps) => {
  const agentApi = desktopApi?.agent;
  const [sessions, setSessions] = useState<readonly AgentSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadSessions = useCallback(async (): Promise<void> => {
    if (agentApi === undefined) {
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const listed = await agentApi.listSessions();
      setSessions(listed);
      setSelectedSessionId((current) => {
        if (current !== null && listed.some((session) => session.id === current)) {
          return current;
        }
        return listed[0]?.id ?? null;
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [agentApi]);

  useEffect(() => {
    if (agentApi === undefined) {
      return;
    }
    void loadSessions();
  }, [agentApi, loadSessions]);

  useEffect(() => {
    if (agentApi === undefined) {
      return;
    }
    return agentApi.onEvent((_event) => {
      void loadSessions();
    });
  }, [agentApi, loadSessions]);

  const createSession = useCallback(async (): Promise<void> => {
    if (agentApi === undefined || isCreating) {
      return;
    }
    setIsCreating(true);
    setErrorMessage(null);
    try {
      const created = await agentApi.createSession({
        title: newSessionTitle,
        ...(defaultProfileId === null || defaultProfileId === undefined
          ? {}
          : { profileId: defaultProfileId })
      });
      await loadSessions();
      setSelectedSessionId(created.id);
      emitAgentSessionSelected(created.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCreating(false);
    }
  }, [agentApi, defaultProfileId, isCreating, loadSessions, newSessionTitle]);

  const deleteSession = useCallback(
    async (sessionId: string): Promise<void> => {
      if (agentApi === undefined) {
        return;
      }
      setErrorMessage(null);
      try {
        await agentApi.deleteSession({ sessionId });
        const next = sessions.filter((session) => session.id !== sessionId);
        setSessions(next);
        const fallbackId = next[0]?.id ?? null;
        setSelectedSessionId((current) => {
          if (current !== sessionId) {
            return current;
          }
          return fallbackId;
        });
        if (fallbackId !== null) {
          emitAgentSessionSelected(fallbackId);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [agentApi, sessions]
  );

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions]
  );

  if (agentApi === undefined) {
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
              void createSession();
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
          {sessions.length === 0 ? (
            <div className="lyra-ai-history-empty-list">
              {isLoading ? loadingSessionsLabel : emptyStateTitle}
            </div>
          ) : (
            <div className="lyra-ai-history-list">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={
                    session.id === selectedSessionId
                      ? "lyra-ai-history-item lyra-ai-history-item-active"
                      : "lyra-ai-history-item"
                  }
                  onClick={() => {
                    setSelectedSessionId(session.id);
                  }}
                >
                  <strong>{session.title}</strong>
                  <small>{formatSessionTime(session.updatedAt, locale)}</small>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="lyra-ai-history-detail-pane">
          {selectedSession === null ? (
            <div className="lyra-ai-history-empty">
              <strong>{emptyStateTitle}</strong>
              <span>{emptyStateDescription}</span>
            </div>
          ) : (
            <div className="lyra-ai-history-detail-card">
              <header className="lyra-ai-history-detail-header">
                <strong>{selectedSession.title}</strong>
                <span>{formatSessionTime(selectedSession.updatedAt, locale)}</span>
              </header>
              <div className="lyra-ai-history-detail-meta">
                <div>
                  <span>{sessionIdLabel}</span>
                  <strong>{selectedSession.id}</strong>
                </div>
                <div>
                  <span>{profileLabel}</span>
                  <strong>{selectedSession.profileId ?? "-"}</strong>
                </div>
              </div>
              <div className="lyra-ai-history-detail-actions">
                <button
                  type="button"
                  className="lyra-ai-history-button"
                  onClick={() => {
                    emitAgentSessionSelected(selectedSession.id);
                  }}
                >
                  <ArrowRight size={13} />
                  <span>{openConversationLabel}</span>
                </button>
                <button
                  type="button"
                  className="lyra-ai-history-button lyra-ai-history-button-danger"
                  onClick={() => {
                    void deleteSession(selectedSession.id);
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
