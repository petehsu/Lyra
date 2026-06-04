import React, { useCallback, useMemo, useState, useEffect } from "react";

import type {
  AgentSessionSummary,
  LyraDesktopApi,
  WorkbenchBrowserPageRuntimeState
} from "../../../shared/desktop-bridge";
import type {
  AgentSessionHistoryCategory,
  AgentSessionHistoryLocateRequest
} from "../agent-session-history";
import type { FileEditorAppState } from "../file-editor";
import type { FileManagerAppState } from "../file-manager";
import type { WorkbenchOmniboxNonBrowserSubmitTarget } from "../preferences";
import type { WorkspaceTab, WorkspaceTabsModel } from "../workspace-tabs";
import { filterBrowserHistoryEntries, readBrowserHistoryEntries } from "../browser-history/service";
import { resolveWorkbenchNavigationInput } from "./navigation-input";
import type { TitlebarNavigationPrimaryActionKind } from "./titlebar-navigation";

export type OmniboxSuggestion = {
  readonly value: string;
  readonly type: "search" | "history";
  readonly label?: string;
  readonly historyTarget?: AgentSessionHistoryLocateRequest["target"];
};

type OpenSearchSuggestionProvider = {
  readonly id: string;
  readonly label: string;
  readonly suggestionUrl: string;
};

const DEFAULT_OPENSEARCH_SUGGESTION_PROVIDERS: readonly OpenSearchSuggestionProvider[] = [
  {
    id: "google-opensearch",
    label: "Google",
    suggestionUrl:
      "https://suggestqueries.google.com/complete/search?client=firefox&q={searchTerms}"
  }
];

const MEDIAWIKI_OPENSEARCH_PROVIDER: OpenSearchSuggestionProvider = {
  id: "wikipedia-opensearch",
  label: "Wikipedia",
  suggestionUrl:
    "https://en.wikipedia.org/w/api.php?action=opensearch&search={searchTerms}&limit=5&namespace=0&format=json&origin=*"
};

const resolveOpenSearchSuggestionUrl = (
  template: string,
  query: string
): string => {
  const encoded = encodeURIComponent(query);
  if (template.includes("{searchTerms}")) {
    return template.replaceAll("{searchTerms}", encoded);
  }
  const separator = template.includes("?") ? "&" : "?";
  return `${template}${separator}q=${encoded}`;
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

const fetchOpenSearchSuggestions = async (
  query: string,
  provider: OpenSearchSuggestionProvider
): Promise<readonly OmniboxSuggestion[]> => {
  if (query.trim().length === 0) return [];
  try {
    const res = await fetch(resolveOpenSearchSuggestionUrl(provider.suggestionUrl, query));
    if (!res.ok) return [];
    const suggestions = parseOpenSearchSuggestionPayload(await res.json());
    return suggestions.map((suggestion) => ({
      value: suggestion,
      type: "search" as const,
      label: provider.label
    }));
  } catch (err) {
    console.error(`Failed to fetch ${provider.label} suggestions:`, err);
  }
  return [];
};

const fetchSearchSuggestions = async (
  query: string
): Promise<readonly OmniboxSuggestion[]> => {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) return [];

  const providers = [
    ...DEFAULT_OPENSEARCH_SUGGESTION_PROVIDERS,
    MEDIAWIKI_OPENSEARCH_PROVIDER
  ];
  const batches = await Promise.all(
    providers.map((provider) => fetchOpenSearchSuggestions(trimmedQuery, provider))
  );
  return batches.flat();
};

type UseTitlebarNavigationModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly activeTab: WorkspaceTab | undefined;
  readonly activePageRuntimeState: WorkbenchBrowserPageRuntimeState | null;
  readonly activeFileEditorState: FileEditorAppState | null;
  readonly activeFileManagerState: FileManagerAppState | null;
  readonly tabsModel: Pick<
    WorkspaceTabsModel,
    "navigateResolvedInput" | "updateActiveInput"
  >;
  readonly omniboxNonBrowserSubmitTarget: WorkbenchOmniboxNonBrowserSubmitTarget;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly submitLabel: string;
  readonly reloadLabel: string;
  readonly onReload: () => void;
  readonly historyAppPlaceholder?: string;
  readonly onHistoryAppReload?: () => void;
  readonly historyAppSuggestionLabels?: {
    readonly sessions: string;
    readonly projectSessions: string;
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

type TitlebarNavigationModel = {
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

  // New autocomplete additions:
  readonly suggestions: readonly OmniboxSuggestion[];
  readonly selectedIndex: number;
  readonly showSuggestions: boolean;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  readonly onSuggestionClick: (suggestion: OmniboxSuggestion) => void;
};

const isBrowserLikeTab = (tab: WorkspaceTab | undefined): tab is WorkspaceTab =>
  tab !== undefined &&
  (tab.pageKind === "page" || tab.pageKind === "search" || tab.pageKind === "results");

type HistoryAppWorkspaceTab = WorkspaceTab & {
  readonly pageKind: "app";
  readonly appId: "agent-session-history";
};

const isHistoryAppTab = (tab: WorkspaceTab | undefined): tab is HistoryAppWorkspaceTab =>
  tab?.pageKind === "app" && tab.appId === "agent-session-history";

const hasProjectBinding = (session: AgentSessionSummary): boolean =>
  (session.workingDir ?? "").trim().length > 0;

const getSessionHistoryCategory = (
  session: AgentSessionSummary
): Exclude<AgentSessionHistoryCategory, "browser-history"> => {
  if (session.archived) {
    return "archived-sessions";
  }
  return hasProjectBinding(session) ? "project-sessions" : "sessions";
};

const getHistoryCategoryLabel = (
  category: AgentSessionHistoryCategory,
  labels: NonNullable<UseTitlebarNavigationModelOptions["historyAppSuggestionLabels"]>
): string => {
  switch (category) {
    case "sessions":
      return labels.sessions;
    case "project-sessions":
      return labels.projectSessions;
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
  labels: NonNullable<UseTitlebarNavigationModelOptions["historyAppSuggestionLabels"]>
): Promise<readonly OmniboxSuggestion[]> => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return [];
  }

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

const getContextualValue = (params: {
  readonly activeTab: WorkspaceTab | undefined;
  readonly activePageRuntimeState: WorkbenchBrowserPageRuntimeState | null;
  readonly activeFileEditorState: FileEditorAppState | null;
  readonly activeFileManagerState: FileManagerAppState | null;
}): string => {
  const { activeTab, activePageRuntimeState, activeFileEditorState, activeFileManagerState } = params;
  if (activeTab === undefined) {
    return "";
  }

  if (activeTab.pageKind === "page") {
    return activePageRuntimeState?.address ?? activeTab.displayAddress;
  }

  if (activeTab.pageKind === "search" || activeTab.pageKind === "results") {
    return activeTab.inputValue;
  }

  if (activeTab.pageKind === "app" && activeTab.appId === "file-editor") {
    return activeFileEditorState?.filePath ?? activeTab.filePath ?? "";
  }

  if (activeTab.pageKind === "app" && activeTab.appId === "file-manager") {
    const currentLocation = activeFileManagerState?.currentLocation ?? null;
    return currentLocation?.kind === "directory" && currentLocation.path !== undefined
      ? currentLocation.path
      : "";
  }

  return "";
};

export const useTitlebarNavigationModel = ({
  desktopApi,
  activeTab,
  activePageRuntimeState,
  activeFileEditorState,
  activeFileManagerState,
  tabsModel,
  omniboxNonBrowserSubmitTarget,
  placeholder,
  ariaLabel,
  submitLabel,
  reloadLabel,
  onReload,
  historyAppPlaceholder,
  onHistoryAppReload,
  historyAppSuggestionLabels,
  onHistoryAppSuggestionSelect,
  onOpenFilePath,
  onOpenDirectoryPath,
  onRunTerminalCommand
}: UseTitlebarNavigationModelOptions): TitlebarNavigationModel => {
  const [draftByTabId, setDraftByTabId] = useState<Readonly<Record<string, string>>>({});

  // Autocomplete states
  const [suggestions, setSuggestions] = useState<readonly OmniboxSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [sessionHistory, setSessionHistory] = useState<readonly string[]>([]);

  const contextualValue = useMemo(
    () =>
      getContextualValue({
        activeTab,
        activePageRuntimeState,
        activeFileEditorState,
        activeFileManagerState
      }),
    [activeFileEditorState, activeFileManagerState, activePageRuntimeState, activeTab]
  );

  const currentDraft = activeTab === undefined ? undefined : draftByTabId[activeTab.id];
  const activeTabId = activeTab?.id ?? null;
  const activeTabIsHistoryApp = isHistoryAppTab(activeTab);
  const value = isBrowserLikeTab(activeTab) || activeTabIsHistoryApp
    ? activeTab.inputValue
    : currentDraft ?? contextualValue;
  const activePageAddress =
    activeTab?.pageKind === "page"
      ? activePageRuntimeState?.address ?? activeTab.displayAddress
      : "";
  const primaryActionKind: TitlebarNavigationPrimaryActionKind =
    activeTabIsHistoryApp
      ? "reload"
      : (
        activeTab?.pageKind === "page" &&
        activePageAddress.length > 0 &&
        value.trim() === activePageAddress
      )
        ? "reload"
        : "submit";
  const isContextualAddress =
    isBrowserLikeTab(activeTab) === false &&
    activeTabIsHistoryApp === false &&
    currentDraft === undefined &&
    contextualValue.trim().length > 0;
  const resolvedPlaceholder =
    activeTabIsHistoryApp && historyAppPlaceholder !== undefined
      ? historyAppPlaceholder
      : placeholder;

  // Search Autocomplete Suggestion Fetching & Debouncing
  useEffect(() => {
    if (
      !showSuggestions
      || (!isBrowserLikeTab(activeTab) && !activeTabIsHistoryApp)
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
        if (cancelled) {
          return;
        }
        setSuggestions(nextHistorySuggestions);
        setSelectedIndex(-1);
        return;
      }

      const searchSuggestions = await fetchSearchSuggestions(value);
      if (cancelled) {
        return;
      }

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

      const combined = [...matchedSessionHistory, ...matchedBrowserHistory, ...searchSuggestions];

      const seen = new Set<string>();
      const unique = combined.filter(item => {
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
    activeTab,
    activeTabIsHistoryApp,
    desktopApi,
    historyAppSuggestionLabels,
    sessionHistory,
    showSuggestions,
    value
  ]);

  const clearDraft = useCallback((tabId: string): void => {
    setDraftByTabId((current) => {
      if (current[tabId] === undefined) {
        return current;
      }
      const next = { ...current };
      delete next[tabId];
      return next;
    });
  }, []);

  const onChange = useCallback((nextValue: string): void => {
    if (activeTab === undefined || activeTabId === null) {
      return;
    }

    if (isBrowserLikeTab(activeTab) || isHistoryAppTab(activeTab)) {
      tabsModel.updateActiveInput(nextValue);
      return;
    }

    setDraftByTabId((current) => {
      if (current[activeTabId] === nextValue) {
        return current;
      }
      return {
        ...current,
        [activeTabId]: nextValue
      };
    });
  }, [activeTab, activeTabId, tabsModel]);

  const executeResolution = useCallback(async (resolution: any) => {
    if (activeTab === undefined || activeTabId === null) {
      return;
    }

    if (isBrowserLikeTab(activeTab)) {
      switch (resolution.kind) {
        case "empty":
          tabsModel.navigateResolvedInput({ kind: "home" }, { target: "active-tab" });
          return;
        case "command":
          await onRunTerminalCommand?.(resolution.command);
          setSessionHistory(curr => [...new Set([...curr, `> ${resolution.command}`])]);
          return;
        case "url":
          tabsModel.navigateResolvedInput(
            { kind: "page", address: resolution.address },
            { target: "active-tab" }
          );
          setSessionHistory(curr => [...new Set([...curr, resolution.address])]);
          return;
        case "search":
          tabsModel.navigateResolvedInput(
            { kind: "search", query: resolution.query, mode: "standard" },
            { target: "active-tab" }
          );
          return;
        case "file":
          onOpenFilePath(resolution.path);
          return;
        case "directory":
          await onOpenDirectoryPath(resolution.path);
          return;
      }
    }

    switch (resolution.kind) {
      case "empty":
        clearDraft(activeTabId);
        return;
      case "command":
        await onRunTerminalCommand?.(resolution.command);
        setSessionHistory(curr => [...new Set([...curr, `> ${resolution.command}`])]);
        clearDraft(activeTabId);
        return;
      case "url":
        tabsModel.navigateResolvedInput(
          { kind: "page", address: resolution.address },
          {
            target:
              omniboxNonBrowserSubmitTarget === "replace_active_tab"
                ? "active-tab"
                : "new-tab"
          }
        );
        setSessionHistory(curr => [...new Set([...curr, resolution.address])]);
        clearDraft(activeTabId);
        return;
      case "search":
        tabsModel.navigateResolvedInput(
          { kind: "search", query: resolution.query, mode: "standard" },
          {
            target:
              omniboxNonBrowserSubmitTarget === "replace_active_tab"
                ? "active-tab"
                : "new-tab"
          }
        );
        clearDraft(activeTabId);
        return;
      case "file":
        onOpenFilePath(resolution.path);
        clearDraft(activeTabId);
        return;
      case "directory":
        await onOpenDirectoryPath(resolution.path);
        clearDraft(activeTabId);
        return;
    }
  }, [
    activeTab,
    activeTabId,
    clearDraft,
    omniboxNonBrowserSubmitTarget,
    onOpenDirectoryPath,
    onOpenFilePath,
    onRunTerminalCommand,
    tabsModel
  ]);

  const onSubmit = useCallback(async (): Promise<void> => {
    if (activeTab === undefined || activeTabId === null) {
      return;
    }

    if (primaryActionKind === "reload") {
      if (activeTabIsHistoryApp) {
        onHistoryAppReload?.();
        return;
      }
      onReload();
      return;
    }

    setShowSuggestions(false);
    const resolution = await resolveWorkbenchNavigationInput(value, desktopApi);
    await executeResolution(resolution);
  }, [
    activeTab,
    activeTabId,
    activeTabIsHistoryApp,
    desktopApi,
    executeResolution,
    onHistoryAppReload,
    primaryActionKind,
    onReload,
    value
  ]);

  const selectSuggestion = useCallback(async (sug: OmniboxSuggestion) => {
    onChange(sug.value);
    setShowSuggestions(false);
    if (activeTabIsHistoryApp && sug.historyTarget !== undefined) {
      onHistoryAppSuggestionSelect?.(sug.historyTarget);
      return;
    }
    const resolution = await resolveWorkbenchNavigationInput(sug.value, desktopApi);
    await executeResolution(resolution);
  }, [
    activeTabIsHistoryApp,
    desktopApi,
    executeResolution,
    onChange,
    onHistoryAppSuggestionSelect
  ]);

  const onKeyDown = useCallback(
    async (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (!showSuggestions || suggestions.length === 0) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((curr) => (curr + 1 < suggestions.length ? curr + 1 : curr));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((curr) => (curr - 1 >= -1 ? curr - 1 : curr));
      } else if (event.key === "Escape") {
        setShowSuggestions(false);
      } else if (event.key === "Enter") {
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          event.preventDefault();
          const selected = suggestions[selectedIndex];
          if (selected !== undefined) {
            await selectSuggestion(selected);
          }
        }
      }
    },
    [showSuggestions, suggestions, selectedIndex, selectSuggestion]
  );

  const onBlur = useCallback((): void => {
    // Delay blur slightly to let suggestion click register first
    setTimeout(() => {
      setShowSuggestions(false);
    }, 150);

    if (activeTab === undefined || activeTabId === null || isBrowserLikeTab(activeTab)) {
      return;
    }
    if ((draftByTabId[activeTabId] ?? "").trim().length === 0) {
      clearDraft(activeTabId);
    }
  }, [activeTab, activeTabId, clearDraft, draftByTabId]);

  return {
    value,
    placeholder: resolvedPlaceholder,
    ariaLabel,
    submitLabel,
    reloadLabel,
    primaryActionKind,
    isContextualAddress,
    onChange,
    onSubmit,
    onFocus: () => setShowSuggestions(true),
    onBlur,

    // Autocomplete predictions integration
    suggestions,
    selectedIndex,
    showSuggestions,
    onKeyDown,
    onSuggestionClick: selectSuggestion
  };
};
