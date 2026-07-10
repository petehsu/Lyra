import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent
} from "react";
import {
  AppButton,
  AppEmptyState,
  AppIconButton,
  AppLoadingState,
  AppObjectRow,
  AppStatusMessage,
  AppToolbarButton
} from "@renderer/ui/components";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Pencil,
  Star,
  StarOff,
  Trash2
} from "lucide-react";

import {
  agentSessionToChatMessages,
  applyAgentRuntimeEventToSnapshot
} from "../agent-session-view-model";
import type {
  AgentSessionSnapshot,
  AgentSessionSummary
} from "../../../shared/desktop-bridge";
import type { OmaAgentMember } from "../../../shared/agent";
import type { FileManagerFavorite } from "../../../shared/file-manager";
import {
  filterBrowserHistoryEntries,
  type BrowserHistoryEntry
} from "../browser-history/service";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";
import { ContextMenuHost, useContextMenuModel } from "../context-menu";
import { DataContextProvider, Message, createDataProviderValue } from "../ai-panel/lyra-agents";
import type {
  AgentSessionHistoryCategory,
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

type ProjectSessionGroup = {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly sessions: readonly AgentSessionSummary[];
};

const RECENT_SESSION_GROUP_ID = "__recent__";

const projectFolderNameFromPath = (value: string): string => {
  const normalized = value.trim().replace(/[\\/]+$/u, "");
  if (normalized.length === 0) {
    return value;
  }
  const parts = normalized.split(/[\\/]+/u);
  return parts[parts.length - 1] ?? normalized;
};

const groupProjectSessions = (
  sessions: readonly AgentSessionSummary[],
  recentGroupName: string
): readonly ProjectSessionGroup[] => {
  const groups = new Map<string, AgentSessionSummary[]>();
  sessions.forEach((session) => {
    const workingDir = session.workingDir?.trim();
    const groupId = workingDir === undefined || workingDir.length === 0
      ? RECENT_SESSION_GROUP_ID
      : workingDir;
    const group = groups.get(groupId);
    if (group === undefined) {
      groups.set(groupId, [session]);
    } else {
      group.push(session);
    }
  });

  return Array.from(groups.entries()).map(([path, groupSessions]) => {
    const isRecentGroup = path === RECENT_SESSION_GROUP_ID;
    return {
      id: path,
      name: isRecentGroup ? recentGroupName : projectFolderNameFromPath(path),
      path: isRecentGroup ? recentGroupName : path,
      sessions: groupSessions
    };
  });
};

const sessionSearchText = (session: AgentSessionSummary): string =>
  normalize([
    session.title,
    session.customTitle,
    session.saveLabel,
    session.shortName
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

const hostnameFromUrl = (value: string): string => {
  try {
    return new URL(value).hostname.replace(/^www\./u, "");
  } catch (_error) {
    return value;
  }
};

const fallbackFaviconUrlFromEntry = (entry: BrowserHistoryEntry): string | undefined => {
  try {
    return new URL("/favicon.ico", entry.url).href;
  } catch (_error) {
    return undefined;
  }
};

const faviconFallbackLabel = (entry: BrowserHistoryEntry): string => {
  const label = hostnameFromUrl(entry.url).trim();
  return (label[0] ?? "?").toLocaleUpperCase();
};

const sessionFavoriteId = (sessionId: string): string => `agent-session:${sessionId}`;

const sessionToFavorite = (session: AgentSessionSummary): FileManagerFavorite => {
  const workingDir = session.workingDir?.trim();
  return {
    id: sessionFavoriteId(session.id),
    title: session.customTitle ?? session.title,
    path: sessionFavoriteId(session.id),
    kind: "agent-session",
    sessionId: session.id,
    ...(workingDir === undefined || workingDir.length === 0 ? {} : { workingDir })
  };
};

const BrowserHistoryFavicon = ({ entry }: { readonly entry: BrowserHistoryEntry }) => {
  const [failed, setFailed] = useState(false);
  const faviconUrl = entry.faviconUrl?.trim() || fallbackFaviconUrlFromEntry(entry);

  useEffect(() => {
    setFailed(false);
  }, [faviconUrl]);

  if (faviconUrl !== undefined && faviconUrl.length > 0 && !failed) {
    return (
      <img
        src={faviconUrl}
        alt=""
        aria-hidden="true"
        className="lyra-agent-history-site-favicon"
        loading="eager"
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span className="lyra-agent-history-site-favicon-fallback" aria-hidden="true">
      {faviconFallbackLabel(entry)}
    </span>
  );
};

const isRowActivationKey = (event: KeyboardEvent<HTMLElement>): boolean =>
  event.key === "Enter" || event.key === " ";

const SessionRow = ({
  session,
  labels,
  active,
  selected,
  opening,
  busy,
  onPreview,
  onOpen,
  onContextMenu,
  onDelete
}: {
  readonly session: AgentSessionSummary;
  readonly labels: AgentSessionHistorySurfaceProps["labels"];
  readonly active: boolean;
  readonly selected: boolean;
  readonly opening: boolean;
  readonly busy: boolean;
  readonly onPreview: (sessionId: string) => void;
  readonly onOpen: (sessionId: string) => void;
  readonly onContextMenu: (event: MouseEvent<HTMLElement>, session: AgentSessionSummary) => void;
  readonly onDelete: (session: AgentSessionSummary) => void;
}) => {
  const disabled = opening || busy;

  const handleActivate = () => {
    if (!disabled) {
      onOpen(session.id);
    }
  };

  const handlePreview = () => {
    if (!disabled) {
      onPreview(session.id);
    }
  };

  const handleContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    onContextMenu(event, session);
  };

  return (
    <AppObjectRow
      as="div"
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled ? "true" : undefined}
      aria-label={`${labels.openInAiPanel}: ${session.title}`}
      className={
        [
          "lyra-agent-history-row",
          "lyra-agent-history-session-row",
          active ? "lyra-agent-history-row-active" : "",
          selected ? "lyra-agent-history-row-selected" : ""
        ].filter(Boolean).join(" ")
      }
      active={active || selected}
      onClick={handleActivate}
      onMouseEnter={handlePreview}
      onFocus={handlePreview}
      onContextMenu={handleContextMenu}
      onKeyDown={(event) => {
        if (isRowActivationKey(event)) {
          event.preventDefault();
          handleActivate();
        }
      }}
      title={<span title={session.title}>{session.title}</span>}
      actions={(
        <AppIconButton
          className="lyra-agent-history-row-action"
          tone="danger"
          aria-label={`${labels.delete}: ${session.title}`}
          title={labels.delete}
          disabled={disabled}
          onClick={() => onDelete(session)}
        >
          <Trash2 size={14} aria-hidden="true" />
        </AppIconButton>
      )}
    />
  );
};

const BrowserHistoryRow = ({
  entry,
  labels,
  selected,
  onPreview,
  onOpen
}: {
  readonly entry: BrowserHistoryEntry;
  readonly labels: AgentSessionHistorySurfaceProps["labels"];
  readonly selected: boolean;
  readonly onPreview: (entry: BrowserHistoryEntry) => void;
  readonly onOpen: (entry: BrowserHistoryEntry) => void;
}) => {
  const handleActivate = () => {
    onPreview(entry);
  };

  return (
    <AppObjectRow
      as="div"
      role="button"
      tabIndex={0}
      aria-label={`${labels.categoryBrowserHistory}: ${entry.title}`}
      className={
        [
          "lyra-agent-history-row",
          "lyra-agent-history-web-row",
          selected ? "lyra-agent-history-row-selected" : ""
        ].filter(Boolean).join(" ")
      }
      active={selected}
      onClick={handleActivate}
      onKeyDown={(event) => {
        if (isRowActivationKey(event)) {
          event.preventDefault();
          handleActivate();
        }
      }}
      icon={<BrowserHistoryFavicon entry={entry} />}
      title={<span title={entry.title}>{entry.title}</span>}
      actions={(
        <AppIconButton
          className="lyra-agent-history-row-action"
          aria-label={`${labels.openBrowserHistoryEntry}: ${entry.url}`}
          title={labels.openBrowserHistoryEntry}
          onClick={() => onOpen(entry)}
        >
          <ExternalLink size={14} aria-hidden="true" />
        </AppIconButton>
      )}
    />
  );
};

const BrowserHistoryPreviewPane = ({
  entry,
  labels,
  previewPageId,
  onPreviewHostChange
}: {
  readonly entry: BrowserHistoryEntry | null;
  readonly labels: AgentSessionHistorySurfaceProps["labels"];
  readonly previewPageId?: string;
  readonly onPreviewHostChange?: (tabId: string, element: HTMLElement | null) => void;
}) => {
  const handlePreviewHostRef = useCallback((element: HTMLElement | null): void => {
    if (previewPageId === undefined) {
      return;
    }
    onPreviewHostChange?.(previewPageId, element);
  }, [onPreviewHostChange, previewPageId]);

  if (entry === null) {
    return (
      <aside className="lyra-agent-history-preview" aria-label={labels.categoryBrowserHistory}>
        <AppEmptyState
          className="lyra-agent-history-preview-empty"
          title={labels.browserHistoryEmptyTitle}
        />
      </aside>
    );
  }

  return (
    <aside className="lyra-agent-history-preview" aria-label={labels.categoryBrowserHistory}>
      <div
        ref={handlePreviewHostRef}
        className="lyra-agent-history-web-page-host"
        aria-label={entry.title}
        data-browser-page-host="true"
        data-tab-id={previewPageId}
      />
    </aside>
  );
};

const AgentSessionPreviewPane = ({
  snapshot,
  labels,
  loading,
  onSelectOmaChannel
}: {
  readonly snapshot: AgentSessionSnapshot | null;
  readonly labels: AgentSessionHistorySurfaceProps["labels"];
  readonly loading: boolean;
  readonly onSelectOmaChannel?: (sessionId: string, channelId: string) => Promise<void>;
}) => {
  if (loading) {
    return (
      <aside className="lyra-agent-history-preview" aria-label={labels.previewTitle}>
        <AppLoadingState className="lyra-agent-history-preview-state" title={labels.loading} />
      </aside>
    );
  }

  if (snapshot === null) {
    return (
      <aside className="lyra-agent-history-preview" aria-label={labels.previewTitle}>
        <AppEmptyState
          className="lyra-agent-history-preview-empty"
          title={labels.previewEmptyTitle}
        />
      </aside>
    );
  }

  const messages = agentSessionToChatMessages(snapshot).map((message) => ({
    ...message,
    rollback: null
  }));
  const workingDir = (snapshot.workingDir ?? "").trim();
  const oma = snapshot.agentMode === "oma" ? snapshot.oma : null;
  const agentsById = new Map((oma?.agents ?? []).map((agent) => [agent.id, agent]));
  const avatarTone = (agentId: string): string => {
    const builtInTones: Record<string, string> = {
      "did:lyra:agent:builtin:lead": "1",
      "did:lyra:agent:builtin:builder": "2",
      "did:lyra:agent:builtin:reviewer": "3",
      "did:lyra:agent:builtin:designer": "4",
      "did:lyra:agent:builtin:researcher": "5"
    };
    return builtInTones[agentId]
      ?? `${(Array.from(agentId).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5) + 1}`;
  };
  const dataValue = createDataProviderValue({
    session: {
      id: snapshot.id,
      title: snapshot.title,
      project: snapshot.projectBound && workingDir.length > 0
        ? projectFolderNameFromPath(workingDir)
        : "",
      workingDir: workingDir.length > 0 ? workingDir : null,
      projectBound: snapshot.projectBound,
      workingDirIsHome: snapshot.workingDirIsHome === true,
      totalAdditions: 0,
      totalDeletions: 0,
      tokenEstimate: snapshot.tokenEstimate ?? null
    },
    messages,
    isTurnRunning: snapshot.turnStatus === "running",
    followActivity: snapshot.follow.activity ?? null
  });

  return (
    <aside className="lyra-agent-history-preview" aria-label={labels.previewTitle}>
      {messages.length === 0 ? (
        <AppEmptyState
          className="lyra-agent-history-preview-empty lyra-agent-history-preview-empty-inline"
          density="compact"
          title={labels.emptyTitle}
        />
      ) : (
        <DataContextProvider value={dataValue}>
          <div
            className="lyra-agent-history-preview-chat lyra-agents-chat-scroll"
            role="log"
            aria-label={`${labels.previewTitle}: ${snapshot.title}`}
          >
            <div className="lyra-agent-history-preview-chat-inner lyra-agents-chat-inner">
              {messages.map((message) => (
                <Message key={message.id} message={message} />
              ))}
            </div>
          </div>
        </DataContextProvider>
      )}
      {oma !== null ? (
        <div className="lyra-agent-history-oma-channels" role="tablist" aria-label="Oma channels">
          {oma.channels.filter((channel) => channel.archived !== true).map((channel) => {
            const agent = agentsById.get(channel.memberAgentIds[0] ?? "");
            const members = channel.memberAgentIds
              .map((agentId) => agentsById.get(agentId))
              .filter((member): member is OmaAgentMember => member !== undefined);
            const isGroup = channel.kind === "group";
            const label = channel.kind === "direct"
              ? agent?.shortName ?? agent?.name ?? channel.name
              : channel.name || "Oma";
            const avatar = channel.kind === "direct"
              ? (agent?.avatar.value || agent?.name || label).slice(0, 2).toUpperCase()
              : label.slice(0, 2).toUpperCase();
            const channelStatus = isGroup
              ? (members.some((member) => member.status === "retrying") ? "retrying"
                : members.some((member) => member.status === "running") ? "running"
                  : members.some((member) => member.status === "queued") ? "queued"
                    : "idle")
              : agent?.status ?? "idle";
            return (
              <AppButton
                key={channel.id}
                type="button"
                variant="ghost"
                size="sm"
                className="lyra-agents-oma-channel"
                data-active={channel.id === oma.activeChannelId}
                data-group={isGroup}
                onClick={() => void onSelectOmaChannel?.(snapshot.id, channel.id)}
                aria-label={label}
                title={label}
              >
                <span className="lyra-agents-oma-avatar-stack" data-group={isGroup} aria-hidden="true">
                  {isGroup ? (
                    <span
                      className="lyra-agents-oma-group-orb"
                      data-running={channelStatus === "running"}
                      data-status={channelStatus}
                    />
                  ) : (
                    <span
                      className="lyra-agents-oma-avatar"
                      data-tone={avatarTone(agent?.agentId ?? channel.id)}
                      data-status={channelStatus}
                    >
                      {agent?.avatar.src ? (
                        <img src={`data:image/svg+xml,${encodeURIComponent(agent.avatar.src)}`} alt="" />
                      ) : avatar}
                    </span>
                  )}
                </span>
              </AppButton>
            );
          })}
        </div>
      ) : null}
    </aside>
  );
};

export const AgentSessionHistorySurface = ({
  desktopApi,
  labels,
  activeSessionId = null,
  query = "",
  refreshRequestKey = 0,
  locateRequest = null,
  browserHistory = [],
  browserHistoryPreviewPageId,
  onBrowserHistoryPreviewChange,
  onBrowserHistoryPreviewHostChange,
  onOpenSession,
  onSessionDeleted,
  onOpenBrowserHistoryEntry,
  openDialog
}: AgentSessionHistorySurfaceProps) => {
  const [state, setState] = useState<AgentSessionHistoryState>(EMPTY_STATE);
  const [category, setCategory] = useState<AgentSessionHistoryCategory>("sessions");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null);
  const [preview, setPreview] = useState<AgentSessionHistoryPreviewState>(EMPTY_PREVIEW_STATE);
  const [selectedBrowserHistoryEntryId, setSelectedBrowserHistoryEntryId] = useState<string | null>(null);
  const [collapsedProjectGroupIds, setCollapsedProjectGroupIds] = useState<ReadonlySet<string>>(() => new Set());
  const [operationSessionId, setOperationSessionId] = useState<string | null>(null);
  const contextMenu = useContextMenuModel();
  const refreshRequestKeyRef = useRef(refreshRequestKey);
  const locateRequestKeyRef = useRef(0);

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
    if (refreshRequestKeyRef.current === refreshRequestKey) {
      return;
    }
    refreshRequestKeyRef.current = refreshRequestKey;
    void loadSessions();
  }, [loadSessions, refreshRequestKey]);

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

  const categorySessions = useMemo(() => ({
    sessions: state.sessions.filter((session) => !session.archived),
    "archived-sessions": state.sessions.filter((session) => session.archived)
  }), [state.sessions]);
  const selectedSessions = category === "browser-history"
    ? []
    : categorySessions[category];
  const filteredSessions = useMemo(
    () => filterSessions(selectedSessions, query),
    [query, selectedSessions]
  );
  const filteredBrowserHistory = useMemo(
    () => filterBrowserHistoryEntries(browserHistory, query),
    [browserHistory, query]
  );
  const projectSessionGroups = useMemo(
    () => groupProjectSessions(filteredSessions, labels.groupRecent),
    [filteredSessions, labels.groupRecent]
  );

  useEffect(() => {
    if (category !== "browser-history") {
      return;
    }
    setSelectedBrowserHistoryEntryId((current) => {
      if (current !== null && filteredBrowserHistory.some((entry) => entry.id === current)) {
        return current;
      }
      return filteredBrowserHistory[0]?.id ?? null;
    });
  }, [category, filteredBrowserHistory]);

  useEffect(() => {
    if (selectedBrowserHistoryEntryId === null) {
      return;
    }
    if (browserHistory.some((entry) => entry.id === selectedBrowserHistoryEntryId)) {
      return;
    }
    setSelectedBrowserHistoryEntryId(null);
  }, [browserHistory, selectedBrowserHistoryEntryId]);

  useEffect(() => {
    if (loading) {
      return;
    }
    setPreview((current) => {
      if (current.sessionId === null) {
        return current;
      }
      if (category === "browser-history") {
        return EMPTY_PREVIEW_STATE;
      }
      return selectedSessions.some((session) => session.id === current.sessionId)
        ? current
        : EMPTY_PREVIEW_STATE;
    });
  }, [category, loading, selectedSessions]);

  const categoryOptions = useMemo(() => [
    {
      id: "sessions" as const,
      label: labels.categorySessions,
      count: categorySessions.sessions.length
    },
    {
      id: "archived-sessions" as const,
      label: labels.categoryArchivedSessions,
      count: categorySessions["archived-sessions"].length
    },
    {
      id: "browser-history" as const,
      label: labels.categoryBrowserHistory,
      count: browserHistory.length
    }
  ], [
    browserHistory.length,
    categorySessions,
    labels.categoryArchivedSessions,
    labels.categoryBrowserHistory,
    labels.categorySessions
  ]);

  useWorkbenchTitlebarContribution(useMemo(() => ({
    ariaLabel: labels.categoryFilter,
    controls: (
      <div
        className="lyra-titlebar-context-group lyra-history-titlebar-categories"
        aria-label={labels.categoryFilter}
      >
        {categoryOptions.map((option) => (
          <AppToolbarButton
            key={option.id}
            type="button"
            className={
              category === option.id
                ? "lyra-titlebar-context-text-button lyra-titlebar-context-button-active lyra-history-titlebar-category"
                : "lyra-titlebar-context-text-button lyra-history-titlebar-category"
            }
            active={category === option.id}
            aria-pressed={category === option.id}
            onClick={() => setCategory(option.id)}
          >
            <span>{option.label}</span>
            <span className="lyra-history-titlebar-category-count">{option.count}</span>
          </AppToolbarButton>
        ))}
      </div>
    )
  }), [category, categoryOptions, labels.categoryFilter]));

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

  const selectPreviewOmaChannel = useCallback(async (
    sessionId: string,
    channelId: string
  ): Promise<void> => {
    if (desktopApi?.agent === undefined) {
      setErrorMessage(labels.runtimeUnavailable);
      return;
    }
    const snapshot = await desktopApi.agent.setOmaActiveChannel({ sessionId, channelId });
    setPreview({ sessionId: snapshot.id, snapshot });
  }, [desktopApi, labels.runtimeUnavailable]);

  useEffect(() => {
    if (locateRequest === null || locateRequest.requestKey === locateRequestKeyRef.current) {
      return;
    }
    locateRequestKeyRef.current = locateRequest.requestKey;
    if (locateRequest.target.kind === "session") {
      const locateCategory =
        (locateRequest.target.category as string) === "project-sessions"
          ? "sessions"
          : locateRequest.target.category;
      setCategory(locateCategory);
      void previewSession(locateRequest.target.sessionId);
      return;
    }
    setCategory("browser-history");
    setSelectedBrowserHistoryEntryId(locateRequest.target.entryId);
  }, [locateRequest, previewSession]);

  const openInAiPanel = useCallback(async (sessionId: string): Promise<void> => {
    await onOpenSession(sessionId);
  }, [onOpenSession]);

  const toggleProjectGroup = useCallback((groupId: string): void => {
    setCollapsedProjectGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

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
        const payload = await desktopApi?.files?.readFavorites();
        if (payload !== undefined) {
          await desktopApi?.files?.writeFavorites({
            favorites: payload.favorites.filter((favorite) =>
              favorite.kind !== "agent-session" || favorite.sessionId !== session.id
            )
          });
        }
      } else {
        await agentApi.saveSession({ sessionId: session.id, label: null });
        const payload = await desktopApi?.files?.readFavorites();
        if (payload !== undefined) {
          const nextFavorite = sessionToFavorite(session);
          await desktopApi?.files?.writeFavorites({
            favorites: [
              nextFavorite,
              ...payload.favorites.filter((favorite) =>
                favorite.id !== nextFavorite.id
                && (favorite.kind !== "agent-session" || favorite.sessionId !== session.id)
              )
            ]
          });
        }
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

  const submitRename = useCallback(async (
    session: AgentSessionSummary,
    title: string | null
  ): Promise<void> => {
    const agentApi = desktopApi?.agent;
    if (agentApi === undefined) {
      setErrorMessage(labels.runtimeUnavailable);
      return;
    }
    const sessionId = session.id;
    await runSessionAction(sessionId, async () => {
      await agentApi.renameSession({ sessionId, title });
      const payload = await desktopApi?.files?.readFavorites();
      if (payload !== undefined) {
        const nextTitle = title?.trim();
        await desktopApi?.files?.writeFavorites({
          favorites: payload.favorites.map((favorite) =>
            favorite.kind === "agent-session" && favorite.sessionId === sessionId
              ? { ...favorite, title: nextTitle === undefined || nextTitle.length === 0 ? session.title : nextTitle }
              : favorite
          )
        });
      }
    });
  }, [desktopApi, labels.runtimeUnavailable, runSessionAction]);

  const openRenameDialog = useCallback((session: AgentSessionSummary): void => {
    openDialog({
      title: labels.renameTitle,
      source: {
        title: labels.title,
        subtitle: session.customTitle ?? session.title,
        iconLabel: "AI",
        iconTone: "accent"
      },
      input: {
        id: `rename-${session.id}`,
        label: labels.renamePlaceholder,
        value: session.customTitle ?? session.title,
        placeholder: labels.renamePlaceholder,
        submitActionId: "save"
      },
      actions: [
        {
          id: "clear",
          label: labels.clearRename,
          onSelect: () => {
            void submitRename(session, null);
          }
        },
        {
          id: "cancel",
          label: labels.cancelAction
        },
        {
          id: "save",
          label: labels.saveRename,
          tone: "primary",
          onSelect: ({ inputValue }) => {
            const nextTitle = inputValue?.trim() ?? "";
            void submitRename(session, nextTitle.length === 0 ? null : nextTitle);
          }
        }
      ]
    });
  }, [
    labels.cancelAction,
    labels.clearRename,
    labels.renamePlaceholder,
    labels.renameTitle,
    labels.saveRename,
    labels.title,
    openDialog,
    submitRename
  ]);

  const confirmDelete = useCallback(async (session: AgentSessionSummary): Promise<void> => {
    const agentApi = desktopApi?.agent;
    if (agentApi === undefined) {
      setErrorMessage(labels.runtimeUnavailable);
      return;
    }
    const sessionId = session.id;
    await runSessionAction(sessionId, async () => {
      await agentApi.deleteSession({ sessionId });
      const payload = await desktopApi?.files?.readFavorites();
      if (payload !== undefined) {
        await desktopApi?.files?.writeFavorites({
          favorites: payload.favorites.filter((favorite) =>
            favorite.kind !== "agent-session" || favorite.sessionId !== sessionId
          )
        });
      }
      setPreview((current) =>
        current.sessionId === sessionId ? EMPTY_PREVIEW_STATE : current
      );
      await onSessionDeleted?.(sessionId);
    });
  }, [
    desktopApi,
    labels.runtimeUnavailable,
    onSessionDeleted,
    runSessionAction
  ]);

  const openDeleteDialog = useCallback((session: AgentSessionSummary): void => {
    openDialog({
      title: labels.deleteConfirmTitle,
      description: labels.deleteConfirmDescription,
      source: {
        title: labels.title,
        subtitle: session.customTitle ?? session.title,
        iconLabel: "AI",
        iconTone: "danger"
      },
      actions: [
        {
          id: "cancel",
          label: labels.cancelAction
        },
        {
          id: "delete",
          label: labels.deleteConfirmAction,
          tone: "danger",
          onSelect: () => {
            void confirmDelete(session);
          }
        }
      ]
    });
  }, [
    confirmDelete,
    labels.cancelAction,
    labels.deleteConfirmAction,
    labels.deleteConfirmDescription,
    labels.deleteConfirmTitle,
    labels.title,
    openDialog
  ]);

  const openBrowserHistoryEntry = useCallback((entry: BrowserHistoryEntry): void => {
    void onOpenBrowserHistoryEntry?.(entry);
  }, [onOpenBrowserHistoryEntry]);

  const openSessionContextMenu = useCallback((
    event: MouseEvent<HTMLElement>,
    session: AgentSessionSummary
  ): void => {
    const disabled = operationSessionId === session.id;
    contextMenu.openMenu({
      anchorX: event.clientX,
      anchorY: event.clientY,
      items: [
        {
          id: "save",
          label: session.saved ? labels.unsaved : labels.saved,
          icon: session.saved ? <StarOff size={14} aria-hidden="true" /> : <Star size={14} aria-hidden="true" />,
          disabled,
          onSelect: () => toggleSaved(session)
        },
        {
          id: "archive",
          label: session.archived ? labels.unarchive : labels.archive,
          icon: <Archive size={14} aria-hidden="true" />,
          disabled,
          onSelect: () => toggleArchived(session)
        },
        {
          id: "rename",
          label: labels.rename,
          icon: <Pencil size={14} aria-hidden="true" />,
          disabled,
          onSelect: () => openRenameDialog(session)
        }
      ]
    });
  }, [
    contextMenu,
    labels.archive,
    labels.rename,
    labels.saved,
    labels.unarchive,
    labels.unsaved,
    openRenameDialog,
    operationSessionId,
    toggleArchived,
    toggleSaved
  ]);

  const isBrowserHistoryCategory = category === "browser-history";
  const selectedBrowserHistoryEntry =
    selectedBrowserHistoryEntryId === null
      ? null
      : filteredBrowserHistory.find((entry) => entry.id === selectedBrowserHistoryEntryId) ?? null;

  const renderSessionRow = (session: AgentSessionSummary) => (
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
      onOpen={(sessionId) => {
        void openInAiPanel(sessionId);
      }}
      onContextMenu={openSessionContextMenu}
      onDelete={openDeleteDialog}
    />
  );

  useEffect(() => () => {
    onBrowserHistoryPreviewChange?.(null);
  }, [onBrowserHistoryPreviewChange]);

  useEffect(() => {
    if (
      browserHistoryPreviewPageId === undefined
      || isBrowserHistoryCategory === false
      || selectedBrowserHistoryEntry === null
    ) {
      onBrowserHistoryPreviewChange?.(null);
      return;
    }
    onBrowserHistoryPreviewChange?.({
      tabId: browserHistoryPreviewPageId,
      url: selectedBrowserHistoryEntry.url,
      title: selectedBrowserHistoryEntry.title
    });
  }, [
    browserHistoryPreviewPageId,
    isBrowserHistoryCategory,
    onBrowserHistoryPreviewChange,
    selectedBrowserHistoryEntry
  ]);

  const isLoading = !isBrowserHistoryCategory && loading;
  const hasRows = isBrowserHistoryCategory
    ? filteredBrowserHistory.length > 0
    : filteredSessions.length > 0;
  const emptyTitle = isBrowserHistoryCategory
    ? labels.browserHistoryEmptyTitle
    : labels.emptyTitle;
  return (
    <>
      <ContextMenuHost
        state={contextMenu.state}
        onClose={contextMenu.closeMenu}
        onSelectItem={contextMenu.selectItem}
      />
      <section className="lyra-agent-history" aria-label={labels.title}>
      {errorMessage === null ? null : (
        <AppStatusMessage className="lyra-agent-history-error" role="status" tone="error">
          <strong>{labels.errorTitle}</strong>
          <span>{errorMessage}</span>
        </AppStatusMessage>
      )}

      <section className="lyra-agent-history-split">
        <section className="lyra-app-sidebar-nav lyra-agent-history-list" aria-busy={isLoading}>
          <div className="lyra-app-sidebar-nav-list lyra-agent-history-list-content">
            {isLoading ? (
              <AppLoadingState className="lyra-agent-history-state" title={labels.loading} />
            ) : hasRows === false ? (
              <AppEmptyState
                className="lyra-agent-history-state"
                title={emptyTitle}
              />
            ) : isBrowserHistoryCategory ? (
              <div className="lyra-agent-history-group-list">
                {filteredBrowserHistory.map((entry) => (
                  <BrowserHistoryRow
                    key={entry.id}
                    entry={entry}
                    labels={labels}
                    selected={selectedBrowserHistoryEntryId === entry.id}
                    onPreview={(nextEntry) => setSelectedBrowserHistoryEntryId(nextEntry.id)}
                    onOpen={openBrowserHistoryEntry}
                  />
                ))}
              </div>
            ) : category === "sessions" ? (
              <div className="lyra-agent-history-group-list">
                {projectSessionGroups.map((group) => {
                  const collapsed = collapsedProjectGroupIds.has(group.id);
                  return (
                    <section
                      key={group.id}
                      className="lyra-agent-history-project-group"
                    >
                      <AppButton
                        variant="ghost"
                        className="lyra-agent-history-project-group-toggle"
                        aria-expanded={!collapsed}
                        title={group.path}
                        onClick={() => toggleProjectGroup(group.id)}
                      >
                        {collapsed ? (
                          <ChevronRight size={13} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={13} aria-hidden="true" />
                        )}
                        <span className="lyra-agent-history-project-group-name">{group.name}</span>
                      </AppButton>
                      {collapsed ? null : (
                        <div className="lyra-agent-history-project-group-sessions">
                          {group.sessions.map(renderSessionRow)}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="lyra-agent-history-group-list">
                {filteredSessions.map(renderSessionRow)}
              </div>
            )}
          </div>
        </section>
        {isBrowserHistoryCategory ? (
          <BrowserHistoryPreviewPane
            entry={selectedBrowserHistoryEntry}
            labels={labels}
            {...(browserHistoryPreviewPageId === undefined
              ? {}
              : { previewPageId: browserHistoryPreviewPageId })}
            {...(onBrowserHistoryPreviewHostChange === undefined
              ? {}
              : { onPreviewHostChange: onBrowserHistoryPreviewHostChange })}
          />
        ) : (
          <AgentSessionPreviewPane
            snapshot={preview.snapshot}
            labels={labels}
            loading={openingSessionId !== null && preview.sessionId === openingSessionId}
            onSelectOmaChannel={selectPreviewOmaChannel}
          />
        )}
      </section>
      </section>
    </>
  );
};
