import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";

import type {
  AgentSessionSummary,
  LyraDesktopApi,
  WorkbenchBrowserPageRuntimeState,
  WorkbenchBrowserSearchInPageResult
} from "../../../shared/desktop-bridge";
import type {
  AgentSessionHistoryCategory,
  AgentSessionHistoryLocateRequest
} from "../agent-session-history";
import {
  filterBrowserHistoryEntries,
  readBrowserHistoryEntries
} from "../browser-history/service";
import type { SearchEngineDefinition } from "../browser-search/types";
import type { FileEditorAppState } from "../file-editor";
import type { FileManagerAppState } from "../file-manager";
import type { WorkbenchOmniboxNonBrowserSubmitTarget } from "../preferences";
import type {
  WorkspaceTab,
  WorkspaceTabsModel
} from "../workspace-tabs";
import type { TitlebarNavigationPrimaryActionKind } from "./titlebar-navigation";

export type OmniboxSuggestion = {
  readonly value: string;
  readonly type: "search" | "history";
  readonly label?: string;
  readonly historyTarget?: AgentSessionHistoryLocateRequest["target"];
};

export type UseTitlebarNavigationModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly activeTab: WorkspaceTab | undefined;
  readonly activePageRuntimeState: WorkbenchBrowserPageRuntimeState | null;
  readonly activeFileEditorState: FileEditorAppState | null;
  readonly activeFileManagerState: FileManagerAppState | null;
  readonly searchEngines: readonly SearchEngineDefinition[];
  readonly autoSearchEngines: readonly SearchEngineDefinition[];
  readonly tabsModel: Pick<
    WorkspaceTabsModel,
    "navigateResolvedInput" | "updateActiveInput" | "openWebSearchTabs"
  >;
  readonly omniboxNonBrowserSubmitTarget: WorkbenchOmniboxNonBrowserSubmitTarget;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly submitLabel: string;
  readonly reloadLabel: string;
  readonly addFavoriteLabel: string;
  readonly removeFavoriteLabel: string;
  readonly onReload: () => void;
  readonly historyAppPlaceholder?: string;
  readonly onHistoryAppReload?: () => void;
  readonly historyAppSuggestionLabels?: {
    readonly sessions: string;
    readonly archivedSessions: string;
    readonly browserHistory: string;
  };
  readonly onHistoryAppSuggestionSelect?: (
    target: AgentSessionHistoryLocateRequest["target"]
  ) => void;
  readonly onOpenFilePath: (path: string) => string | null;
  readonly onOpenDirectoryPath: (path: string) => Promise<void> | void;
  readonly onRunTerminalCommand?: (command: string) => Promise<void> | void;
};

export type TitlebarNavigationModel = {
  readonly mode: "normal" | "page-find";
  readonly value: string;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly submitLabel: string;
  readonly reloadLabel: string;
  readonly primaryActionKind: TitlebarNavigationPrimaryActionKind;
  readonly isContextualAddress: boolean;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => Promise<void>;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
  readonly favoriteButton: {
    readonly visible: boolean;
    readonly active: boolean;
    readonly label: string;
    readonly onToggle: () => void;
  };
  readonly suggestions: readonly OmniboxSuggestion[];
  readonly selectedIndex: number;
  readonly showSuggestions: boolean;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  readonly onSuggestionClick: (suggestion: OmniboxSuggestion) => void;
  readonly focusRequestKey: number;
  readonly pageFindResult: WorkbenchBrowserSearchInPageResult | null;
  readonly onPageFindClose: () => void;
  readonly onPageFindNext: () => Promise<void>;
  readonly onPageFindPrevious: () => Promise<void>;
  readonly onPageFindMatchClick: (index: number) => Promise<void>;
};

export const parseOpenSearchSuggestionPayload = (
  payload: unknown
): readonly string[] => {
  if (!Array.isArray(payload) || payload.length < 2 || !Array.isArray(payload[1])) {
    return [];
  }
  return payload[1]
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
};

const getSessionHistoryCategory = (
  session: AgentSessionSummary
): Exclude<AgentSessionHistoryCategory, "browser-history"> =>
  session.archived ? "archived-sessions" : "sessions";

type HistorySuggestionLabels = NonNullable<
  UseTitlebarNavigationModelOptions["historyAppSuggestionLabels"]
>;

const getHistoryCategoryLabel = (
  category: AgentSessionHistoryCategory,
  labels: HistorySuggestionLabels
): string => {
  switch (category) {
    case "sessions":
      return labels.sessions;
    case "archived-sessions":
      return labels.archivedSessions;
    case "browser-history":
      return labels.browserHistory;
  }
};

const historySessionSearchText = (session: AgentSessionSummary): string =>
  [
    session.title,
    session.customTitle,
    session.saveLabel,
    session.shortName
  ].filter(Boolean).join(" ").toLocaleLowerCase();

const fetchHistoryAppSuggestions = async (
  query: string,
  desktopApi: LyraDesktopApi | null,
  labels: HistorySuggestionLabels
): Promise<readonly OmniboxSuggestion[]> => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) return [];

  const sessionSuggestions =
    desktopApi?.agent === undefined
      ? []
      : (await desktopApi.agent.listSessions({ limit: 500 })).sessions
        .filter((session) => historySessionSearchText(session).includes(normalizedQuery))
        .map((session) => {
          const category = getSessionHistoryCategory(session);
          return {
            value: session.title,
            type: "history" as const,
            label: getHistoryCategoryLabel(category, labels),
            historyTarget: {
              kind: "session" as const,
              sessionId: session.id,
              category
            }
          };
        });

  const browserHistorySuggestions = filterBrowserHistoryEntries(
    readBrowserHistoryEntries(),
    query
  ).map((entry) => ({
    value: entry.title,
    type: "history" as const,
    label: labels.browserHistory,
    historyTarget: {
      kind: "browser-history" as const,
      entryId: entry.id
    }
  }));

  return [...sessionSuggestions, ...browserHistorySuggestions].slice(0, 7);
};

export const useTitlebarSuggestions = ({
  activeTabSupportsSuggestions,
  activeTabIsHistoryApp,
  desktopApi,
  historyAppSuggestionLabels,
  pageFindActive,
  value
}: {
  readonly activeTabSupportsSuggestions: boolean;
  readonly activeTabIsHistoryApp: boolean;
  readonly desktopApi: LyraDesktopApi | null;
  readonly historyAppSuggestionLabels: HistorySuggestionLabels | undefined;
  readonly pageFindActive: boolean;
  readonly value: string;
}) => {
  const [suggestions, setSuggestions] = useState<readonly OmniboxSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [sessionHistory, setSessionHistory] = useState<readonly string[]>([]);

  useEffect(() => {
    if (
      !showSuggestions
      || pageFindActive
      || !activeTabSupportsSuggestions
      || value.trim().length === 0
    ) {
      setSuggestions((current) => current.length === 0 ? current : []);
      setSelectedIndex((current) => current === -1 ? current : -1);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (activeTabIsHistoryApp) {
        const nextHistorySuggestions =
          historyAppSuggestionLabels === undefined
            ? []
            : await fetchHistoryAppSuggestions(
              value,
              desktopApi,
              historyAppSuggestionLabels
            ).catch(() => []);
        if (cancelled) return;
        setSuggestions(nextHistorySuggestions);
        setSelectedIndex(-1);
        return;
      }

      if (cancelled) return;
      const matchedSessionHistory = sessionHistory
        .filter((entry) => entry.toLocaleLowerCase().includes(value.toLocaleLowerCase()))
        .map((entry) => ({
          value: entry,
          type: "history" as const
        }));
      const matchedBrowserHistory = filterBrowserHistoryEntries(
        readBrowserHistoryEntries(),
        value
      ).map((entry) => ({
        value: entry.url,
        type: "history" as const,
        label: entry.title
      }));
      const combined = [
        ...matchedSessionHistory,
        ...matchedBrowserHistory
      ];
      const seen = new Set<string>();
      const unique = combined.filter((item) => {
        const key = item.value.trim().toLowerCase();
        if (key.length === 0 || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 7);
      setSuggestions(unique);
      setSelectedIndex(-1);
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    activeTabIsHistoryApp,
    activeTabSupportsSuggestions,
    desktopApi,
    historyAppSuggestionLabels,
    pageFindActive,
    sessionHistory,
    showSuggestions,
    value
  ]);

  return {
    suggestions,
    setSuggestions,
    selectedIndex,
    setSelectedIndex,
    showSuggestions,
    setShowSuggestions,
    setSessionHistory
  };
};
