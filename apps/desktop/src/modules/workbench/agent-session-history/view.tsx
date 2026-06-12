import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
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
  Bot,
  ChevronDown,
  ChevronRight,
  Clock3,
  ExternalLink,
  Hammer,
  History,
  Image,
  MessageSquare,
  PanelLeftOpen,
  Pencil,
  Star,
  StarOff,
  Trash2,
  UserRound
} from "lucide-react";

import {
  agentSessionToChatMessages,
  applyAgentRuntimeEventToSnapshot
} from "../agent-session-view-model";
import type {
  AgentSessionSnapshot,
  AgentSessionSummary
} from "../../../shared/desktop-bridge";
import {
  filterBrowserHistoryEntries,
  type BrowserHistoryEntry
} from "../browser-history/service";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";
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

type HistoryChatMessage = ReturnType<typeof agentSessionToChatMessages>[number];
type HistoryMessageBlock = HistoryChatMessage["blocks"][number];

const historyAuthorLabel = (author: HistoryChatMessage["author"]): string =>
  author === "user" ? "You" : "Lyra Agents";

const historyToolStatusLabel = (status: "running" | "success" | "error"): string => {
  switch (status) {
    case "running":
      return "Running";
    case "error":
      return "Failed";
    case "success":
      return "Done";
  }
};

const historyImageSrc = (block: Extract<HistoryMessageBlock, { type: "image" }>): string => {
  const data = block.image.data.trim();
  if (data.startsWith("data:")) {
    return data;
  }
  return `data:${block.image.mediaType};base64,${data}`;
};

const hasProjectBinding = (session: AgentSessionSummary): boolean =>
  (session.workingDir ?? "").trim().length > 0;

type ProjectSessionGroup = {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly sessions: readonly AgentSessionSummary[];
};

const projectFolderNameFromPath = (value: string): string => {
  const normalized = value.trim().replace(/[\\/]+$/u, "");
  if (normalized.length === 0) {
    return value;
  }
  const parts = normalized.split(/[\\/]+/u);
  return parts[parts.length - 1] ?? normalized;
};

const groupProjectSessions = (
  sessions: readonly AgentSessionSummary[]
): readonly ProjectSessionGroup[] => {
  const groups = new Map<string, AgentSessionSummary[]>();
  sessions.forEach((session) => {
    const workingDir = session.workingDir?.trim();
    if (workingDir === undefined || workingDir.length === 0) {
      return;
    }
    const group = groups.get(workingDir);
    if (group === undefined) {
      groups.set(workingDir, [session]);
    } else {
      group.push(session);
    }
  });

  return Array.from(groups.entries()).map(([path, groupSessions]) => ({
    id: path,
    name: projectFolderNameFromPath(path),
    path,
    sessions: groupSessions
  }));
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
  const disabled = opening || busy;

  const handleActivate = () => {
    if (!disabled) {
      onPreview(session.id);
    }
  };

  return (
    <AppObjectRow
      as="div"
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled ? "true" : undefined}
      aria-label={`${labels.previewTitle}: ${session.title}`}
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
      onKeyDown={(event) => {
        if (isRowActivationKey(event)) {
          event.preventDefault();
          handleActivate();
        }
      }}
      title={<span title={session.title}>{session.title}</span>}
      description={(
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
      )}
      actions={(
        <>
          <AppIconButton
            className="lyra-agent-history-row-action"
            aria-label={`${labels.openInAiPanel}: ${session.title}`}
            title={labels.openInAiPanel}
            disabled={busy}
            onClick={() => onOpenInAiPanel(session.id)}
          >
            <PanelLeftOpen size={14} aria-hidden="true" />
          </AppIconButton>
          <AppIconButton
            className="lyra-agent-history-row-action"
            aria-label={`${session.saved ? labels.unsaved : labels.saved}: ${session.title}`}
            title={session.saved ? labels.unsaved : labels.saved}
            disabled={disabled}
            onClick={() => onToggleSaved(session)}
          >
            {session.saved ? <StarOff size={14} aria-hidden="true" /> : <Star size={14} aria-hidden="true" />}
          </AppIconButton>
          <AppIconButton
            className="lyra-agent-history-row-action"
            aria-label={`${session.archived ? labels.unarchive : labels.archive}: ${session.title}`}
            title={session.archived ? labels.unarchive : labels.archive}
            disabled={disabled}
            onClick={() => onToggleArchived(session)}
          >
            <Archive size={14} aria-hidden="true" />
          </AppIconButton>
          <AppIconButton
            className="lyra-agent-history-row-action"
            aria-label={`${labels.rename}: ${session.title}`}
            title={labels.rename}
            disabled={disabled}
            onClick={() => onRename(session)}
          >
            <Pencil size={14} aria-hidden="true" />
          </AppIconButton>
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
        </>
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
  const visitedAt = formatSessionTime(entry.visitedAt);
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
      description={(
        <>
          <span className="lyra-agent-history-row-url" title={entry.url}>
            {entry.url}
          </span>
          <span className="lyra-agent-history-row-facts">
            {visitedAt.length === 0 ? null : (
              <span title={`${labels.visited} ${visitedAt}`}>
                <Clock3 size={12} aria-hidden="true" />
                <span>{visitedAt}</span>
              </span>
            )}
            <span>
              <History size={12} aria-hidden="true" />
              <span>{entry.visitCount} {labels.visits}</span>
            </span>
          </span>
        </>
      )}
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
          description={labels.browserHistoryEmptyDescription}
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

const HistoryTranscriptBlock = ({ block }: { readonly block: HistoryMessageBlock }) => {
  if (block.type === "text") {
    const body = block.body.trim();
    if (body.length === 0) {
      return <div className="lyra-agent-history-transcript-pending" aria-label="Pending response" />;
    }
    return (
      <p className="lyra-agent-history-transcript-text">
        {block.body}
      </p>
    );
  }

  if (block.type === "image") {
    const label = block.image.label ?? block.image.source ?? "Image";
    return (
      <figure className="lyra-agent-history-transcript-image">
        <img src={historyImageSrc(block)} alt={label} />
        <figcaption>
          <Image size={12} aria-hidden="true" />
          <span>{label}</span>
        </figcaption>
      </figure>
    );
  }

  return (
    <section
      className="lyra-agent-history-transcript-tool-block"
      data-status={block.group.status}
      aria-label={block.group.label}
    >
      <header className="lyra-agent-history-transcript-tool-head">
        <span className="lyra-agent-history-transcript-tool-icon" aria-hidden="true">
          <Hammer size={13} />
        </span>
        <span className="lyra-agent-history-transcript-tool-title">{block.group.label}</span>
        {block.group.hint === undefined ? null : (
          <span className="lyra-agent-history-transcript-tool-hint">{block.group.hint}</span>
        )}
      </header>
      <div className="lyra-agent-history-transcript-tool-calls">
        {block.group.calls.slice(0, 4).map((call) => (
          <div
            key={call.id}
            className="lyra-agent-history-transcript-tool-call"
            data-status={call.status}
          >
            <span className="lyra-agent-history-transcript-tool-dot" aria-hidden="true" />
            <span className="lyra-agent-history-transcript-tool-call-title">{call.title}</span>
            <span className="lyra-agent-history-transcript-tool-call-status">
              {historyToolStatusLabel(call.status)}
            </span>
          </div>
        ))}
        {block.group.calls.length <= 4 ? null : (
          <div className="lyra-agent-history-transcript-tool-more">
            +{block.group.calls.length - 4}
          </div>
        )}
      </div>
    </section>
  );
};

const HistoryTranscriptMessage = ({ message }: { readonly message: HistoryChatMessage }) => {
  const authorLabel = historyAuthorLabel(message.author);
  const authorIcon = message.author === "user"
    ? <UserRound size={13} aria-hidden="true" />
    : <Bot size={13} aria-hidden="true" />;

  return (
    <article
      className="lyra-agent-history-transcript-message"
      data-author={message.author}
    >
      <header className="lyra-agent-history-transcript-message-head">
        <span className="lyra-agent-history-transcript-author-icon" aria-hidden="true">
          {authorIcon}
        </span>
        <span className="lyra-agent-history-transcript-author">{authorLabel}</span>
        {message.time === undefined ? null : (
          <time className="lyra-agent-history-transcript-time">{message.time}</time>
        )}
      </header>
      <div className="lyra-agent-history-transcript-blocks">
        {message.blocks.map((block) => (
          <HistoryTranscriptBlock key={block.id} block={block} />
        ))}
      </div>
    </article>
  );
};

const AgentSessionPreviewPane = ({
  snapshot,
  labels,
  loading
}: {
  readonly snapshot: AgentSessionSnapshot | null;
  readonly labels: AgentSessionHistorySurfaceProps["labels"];
  readonly loading: boolean;
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
          icon={<History size={22} aria-hidden="true" />}
          title={labels.previewEmptyTitle}
          description={labels.previewEmptyDescription}
        />
      </aside>
    );
  }

  const messages = agentSessionToChatMessages(snapshot);
  const updatedAt = formatSessionTime(snapshot.updatedAt);

  return (
    <aside className="lyra-agent-history-preview" aria-label={labels.previewTitle}>
      <div className="lyra-agent-history-preview-content">
        <header className="lyra-agent-history-transcript-header">
          <span className="lyra-agent-history-transcript-header-icon" aria-hidden="true">
            <Bot size={16} />
          </span>
          <span className="lyra-agent-history-transcript-header-main">
            <h2>{snapshot.title}</h2>
            <span className="lyra-agent-history-transcript-header-meta">
              <span>{messages.length} {labels.messages}</span>
              {updatedAt.length === 0 ? null : <span>{labels.updated} {updatedAt}</span>}
            </span>
          </span>
        </header>
        {messages.length === 0 ? (
          <AppEmptyState
            className="lyra-agent-history-preview-empty lyra-agent-history-preview-empty-inline"
            density="compact"
            title={labels.emptyTitle}
            description={labels.emptyDescription}
          />
        ) : (
          <div
            className="lyra-agent-history-transcript"
            role="log"
            aria-label={`${labels.previewTitle}: ${snapshot.title}`}
          >
            {messages.map((message) => (
              <HistoryTranscriptMessage key={message.id} message={message} />
            ))}
          </div>
        )}
      </div>
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
    sessions: state.sessions.filter((session) => !session.archived && !hasProjectBinding(session)),
    "project-sessions": state.sessions.filter((session) => !session.archived && hasProjectBinding(session)),
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
    () => groupProjectSessions(filteredSessions),
    [filteredSessions]
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
      id: "project-sessions" as const,
      label: labels.categoryProjectSessions,
      count: categorySessions["project-sessions"].length
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
    labels.categoryProjectSessions,
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

  useEffect(() => {
    if (locateRequest === null || locateRequest.requestKey === locateRequestKeyRef.current) {
      return;
    }
    locateRequestKeyRef.current = locateRequest.requestKey;
    if (locateRequest.target.kind === "session") {
      setCategory(locateRequest.target.category);
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
      onOpenInAiPanel={(sessionId) => {
        void openInAiPanel(sessionId);
      }}
      onToggleSaved={toggleSaved}
      onToggleArchived={toggleArchived}
      onRename={openRenameDialog}
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
  const emptyDescription = isBrowserHistoryCategory
    ? labels.browserHistoryEmptyDescription
    : labels.emptyDescription;

  return (
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
                description={emptyDescription}
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
            ) : category === "project-sessions" ? (
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
                        <span className="lyra-agent-history-project-group-count">{group.sessions.length}</span>
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
          />
        )}
      </section>
    </section>
  );
};
