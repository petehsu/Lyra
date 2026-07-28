import React, { useCallback, useMemo, useState, useEffect } from "react";

import type { WorkbenchBrowserSearchInPageResult } from "../../../shared/desktop-bridge";
import type { FileManagerFavorite } from "../../../shared/file-manager";
import type { WorkspaceTab } from "../workspace-tabs";
import { resolveWebSearchTarget } from "../browser-search/service";
import { resolveWorkbenchNavigationInput } from "./navigation-input";
import { reportWorkbenchError } from "@renderer/ui/components";
import { t } from "@workbench/i18n";
import {
  parseOpenSearchSuggestionPayload,
  useTitlebarSuggestions,
  type OmniboxSuggestion,
  type TitlebarNavigationModel,
  type UseTitlebarNavigationModelOptions
} from "./titlebar-navigation-suggestions";

export { parseOpenSearchSuggestionPayload };
export type { OmniboxSuggestion };

const isBrowserLikeTab = (tab: WorkspaceTab | undefined): tab is WorkspaceTab =>
  tab !== undefined &&
  (tab.pageKind === "page" || tab.pageKind === "search" || tab.pageKind === "results");

type HistoryAppWorkspaceTab = WorkspaceTab & {
  readonly pageKind: "app";
  readonly appId: "agent-session-history";
};

const isHistoryAppTab = (tab: WorkspaceTab | undefined): tab is HistoryAppWorkspaceTab =>
  tab?.pageKind === "app" && tab.appId === "agent-session-history";

const createFavoriteId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? `favorite-${crypto.randomUUID()}`
    : `favorite-${Math.random().toString(16).slice(2, 10)}`;

const normalizeWebFavoriteUrl = (value: string): string | null => {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

const getContextualValue = (
  params: Pick<
    UseTitlebarNavigationModelOptions,
    | "activeTab"
    | "activePageRuntimeState"
    | "activeFileEditorState"
    | "activeFileManagerState"
  >
): string => {
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
  searchEngines,
  autoSearchEngines,
  tabsModel,
  omniboxNonBrowserSubmitTarget,
  placeholder,
  ariaLabel,
  submitLabel,
  reloadLabel,
  addFavoriteLabel,
  removeFavoriteLabel,
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
  const [pageFindTabId, setPageFindTabId] = useState<string | null>(null);
  const [pageFindQuery, setPageFindQuery] = useState("");
  const [pageFindResult, setPageFindResult] = useState<WorkbenchBrowserSearchInPageResult | null>(null);
  const [focusRequestKey, setFocusRequestKey] = useState(0);
  const [favorites, setFavorites] = useState<readonly FileManagerFavorite[]>([]);

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
  const activeTabIsBrowserPage = activeTab?.pageKind === "page";
  const pageFindActive = pageFindTabId !== null && pageFindTabId === activeTabId && activeTabIsBrowserPage;
  const value = pageFindActive
    ? pageFindQuery
    : isBrowserLikeTab(activeTab) || activeTabIsHistoryApp
    ? activeTab.inputValue
    : currentDraft ?? contextualValue;
  const {
    suggestions,
    setSuggestions,
    selectedIndex,
    setSelectedIndex,
    showSuggestions,
    setShowSuggestions,
    setSessionHistory
  } = useTitlebarSuggestions({
    activeTabSupportsSuggestions:
      isBrowserLikeTab(activeTab) || activeTabIsHistoryApp,
    activeTabIsHistoryApp,
    desktopApi,
    historyAppSuggestionLabels,
    pageFindActive,
    value
  });
  const activePageAddress =
    activeTab?.pageKind === "page"
      ? activePageRuntimeState?.address ?? activeTab.displayAddress
      : "";
  const activeWebFavoriteUrl = activeTabIsBrowserPage
    ? normalizeWebFavoriteUrl(activePageAddress)
    : null;
  const activeWebFavorite = activeWebFavoriteUrl === null
    ? undefined
    : favorites.find((favorite) =>
      favorite.kind === "web" &&
      normalizeWebFavoriteUrl(favorite.url ?? favorite.path) === activeWebFavoriteUrl
    );
  const primaryActionKind: TitlebarNavigationModel["primaryActionKind"] =
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
    pageFindActive
      ? "Find in page"
      :
    activeTabIsHistoryApp && historyAppPlaceholder !== undefined
      ? historyAppPlaceholder
      : placeholder;

  const resetPageFindState = useCallback((): void => {
    setPageFindTabId(null);
    setPageFindQuery("");
    setPageFindResult(null);
    setShowSuggestions(false);
  }, []);

  useEffect(() => {
    if (desktopApi?.files === undefined) {
      setFavorites([]);
      return undefined;
    }
    let cancelled = false;
    void desktopApi.files.readFavorites()
      .then((payload) => {
        if (!cancelled) {
          setFavorites(payload.favorites);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFavorites([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [desktopApi]);

  const toggleWebFavorite = useCallback((): void => {
    if (desktopApi?.files === undefined || activeWebFavoriteUrl === null) {
      return;
    }
    void desktopApi.files.readFavorites()
      .then(async (payload) => {
        const existing = payload.favorites.find((favorite) =>
          favorite.kind === "web" &&
          normalizeWebFavoriteUrl(favorite.url ?? favorite.path) === activeWebFavoriteUrl
        );
        const nextFavorites =
          existing === undefined
            ? [
                {
                  id: createFavoriteId(),
                  title: activePageRuntimeState?.title?.trim() || activeWebFavoriteUrl,
                  path: activeWebFavoriteUrl,
                  kind: "web" as const,
                  url: activeWebFavoriteUrl,
                  ...(activePageRuntimeState?.faviconUrl === undefined
                    ? {}
                    : { faviconUrl: activePageRuntimeState.faviconUrl })
                },
                ...payload.favorites
              ]
            : payload.favorites.filter((favorite) => favorite.id !== existing.id);
        const written = await desktopApi.files.writeFavorites({ favorites: nextFavorites });
        setFavorites(written.favorites);
      })
      .catch((error: unknown) => {
        reportWorkbenchError(error);
      });
  }, [activePageRuntimeState, activeWebFavoriteUrl, desktopApi]);

  const closePageFind = useCallback((): void => {
    const tabId = pageFindTabId;
    resetPageFindState();
    if (tabId !== null) {
      void desktopApi?.workbenchBrowser.searchInPage({
        tabId,
        query: ""
      }).catch(() => undefined);
      void desktopApi?.workbenchBrowser.setChromePopover?.({
        tabId,
        kind: "find",
        visible: false
      }).catch(() => undefined);
    }
  }, [desktopApi, pageFindTabId, resetPageFindState]);

  const openPageFind = useCallback((tabId: string): void => {
    setPageFindTabId(tabId);
    setPageFindQuery("");
    setPageFindResult(null);
    setSuggestions([]);
    setSelectedIndex(-1);
    setShowSuggestions(false);
    setFocusRequestKey((current) => current + 1);
    void desktopApi?.workbenchBrowser.searchInPage({
      tabId,
      query: ""
    }).catch(() => undefined);
  }, [desktopApi]);

  const runPageFind = useCallback(async (
    direction: "current" | "next" | "previous",
    queryOverride?: string
  ): Promise<void> => {
    if (!pageFindActive || activeTabId === null || desktopApi?.workbenchBrowser === undefined) {
      return;
    }
    const sourceQuery = queryOverride ?? pageFindQuery;
    const query = sourceQuery.trim();
    const result = await desktopApi.workbenchBrowser.searchInPage({
      tabId: activeTabId,
      query,
      activeIndex: pageFindResult?.currentIndex ?? 0,
      direction,
      reveal: query.length > 0,
      maxMatches: 40
    }).catch(() => null);
    if (result !== null) {
      setPageFindResult(result);
    }
  }, [activeTabId, desktopApi, pageFindActive, pageFindQuery, pageFindResult?.currentIndex]);

  const selectPageFindMatch = useCallback(async (index: number): Promise<void> => {
    if (!pageFindActive || activeTabId === null || desktopApi?.workbenchBrowser === undefined) {
      return;
    }
    const query = pageFindQuery.trim();
    if (query.length === 0) {
      return;
    }
    const result = await desktopApi.workbenchBrowser.searchInPage({
      tabId: activeTabId,
      query,
      activeIndex: index,
      direction: "current",
      reveal: true,
      maxMatches: 40
    }).catch(() => null);
    if (result !== null) {
      setPageFindResult(result);
    }
  }, [activeTabId, desktopApi, pageFindActive, pageFindQuery]);

  useEffect(() => {
    if (!pageFindActive || activeTabId === null || desktopApi?.workbenchBrowser === undefined) {
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void desktopApi.workbenchBrowser.searchInPage({
        tabId: activeTabId,
        query: pageFindQuery,
        activeIndex: pageFindResult?.currentIndex ?? 0,
        direction: "current",
        reveal: pageFindQuery.trim().length > 0,
        maxMatches: 40
      }).then((result) => {
        if (!cancelled) {
          setPageFindResult(result);
        }
      }).catch(() => {
        if (!cancelled) {
          setPageFindResult(null);
        }
      });
    }, pageFindQuery.trim().length === 0 ? 0 : 90);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeTabId, desktopApi, pageFindActive, pageFindQuery, pageFindResult?.currentIndex]);

  useEffect(() => {
    if (pageFindTabId !== null && pageFindTabId !== activeTabId) {
      closePageFind();
    }
  }, [activeTabId, closePageFind, pageFindTabId]);

  useEffect(() => {
    if (desktopApi?.workbenchBrowser === undefined) {
      return undefined;
    }
    return desktopApi.workbenchBrowser.onEvent((event) => {
      if (event.kind === "request-page-find" && event.tabId === activeTabId && activeTabIsBrowserPage) {
        openPageFind(event.tabId);
      }
      if (
        event.kind === "request-page-find-match-select"
        && event.tabId === pageFindTabId
        && activeTabIsBrowserPage
      ) {
        void selectPageFindMatch(event.index);
      }
      if (
        event.kind === "chrome-popover-state"
        && event.popoverKind === "find"
        && event.visible === false
        && event.tabId === pageFindTabId
      ) {
        resetPageFindState();
      }
    });
  }, [
    activeTabId,
    activeTabIsBrowserPage,
    desktopApi,
    openPageFind,
    pageFindTabId,
    resetPageFindState,
    selectPageFindMatch
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        event.key.toLocaleLowerCase() === "f"
        && (event.metaKey || event.ctrlKey)
        && !event.altKey
        && activeTabId !== null
        && activeTabIsBrowserPage
      ) {
        event.preventDefault();
        openPageFind(activeTabId);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [activeTabId, activeTabIsBrowserPage, openPageFind]);

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

    if (pageFindActive) {
      setPageFindQuery(nextValue);
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
  }, [activeTab, activeTabId, pageFindActive, tabsModel]);

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
          {
            const target = await resolveWebSearchTarget({
              desktopApi,
              query: resolution.query,
              searchEngines: autoSearchEngines
            });
            if (target === null) {
              return;
            }
            tabsModel.openWebSearchTabs(
                {
                  query: resolution.query,
                  targets: [{
                    address: target.searchUrl,
                    engineId: target.engine.id,
                    title: target.engine.label
                  }],
                  selection: { mode: "auto", engineIds: [] }
                },
                { target: "active-tab" }
              );
          }
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
        {
          const target = await resolveWebSearchTarget({
            desktopApi,
            query: resolution.query,
            searchEngines: autoSearchEngines
          });
          const targetMode =
            omniboxNonBrowserSubmitTarget === "replace_active_tab"
              ? "active-tab"
              : "new-tab";
          if (target === null) {
            return;
          }
          tabsModel.openWebSearchTabs(
            {
              query: resolution.query,
              targets: [{
                address: target.searchUrl,
                engineId: target.engine.id,
                title: target.engine.label
              }],
              selection: { mode: "auto", engineIds: [] }
            },
            {
              target: targetMode
            }
          );
        }
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
    autoSearchEngines,
    clearDraft,
    desktopApi,
    omniboxNonBrowserSubmitTarget,
    onOpenDirectoryPath,
    onOpenFilePath,
    onRunTerminalCommand,
    searchEngines,
    tabsModel
  ]);

  const onSubmit = useCallback(async (): Promise<void> => {
    if (activeTab === undefined || activeTabId === null) {
      return;
    }

    if (pageFindActive) {
      await runPageFind("next");
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
    pageFindActive,
    primaryActionKind,
    onReload,
    runPageFind,
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
      if (pageFindActive) {
        if (event.key === "Escape") {
          event.preventDefault();
          closePageFind();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          await runPageFind(event.shiftKey ? "previous" : "next");
          return;
        }
      }
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
    [closePageFind, pageFindActive, runPageFind, showSuggestions, suggestions, selectedIndex, selectSuggestion]
  );

  const onBlur = useCallback((): void => {
    // Delay blur slightly to let suggestion click register first
    setTimeout(() => {
      setShowSuggestions(false);
    }, 150);

    if (activeTab === undefined || activeTabId === null || isBrowserLikeTab(activeTab) || pageFindActive) {
      return;
    }
    if ((draftByTabId[activeTabId] ?? "").trim().length === 0) {
      clearDraft(activeTabId);
    }
  }, [activeTab, activeTabId, clearDraft, draftByTabId, pageFindActive]);

  return {
    mode: pageFindActive ? "page-find" : "normal",
    value,
    placeholder: resolvedPlaceholder,
    ariaLabel,
    submitLabel,
    reloadLabel,
    primaryActionKind: pageFindActive ? "submit" : primaryActionKind,
    isContextualAddress,
    onChange,
    onSubmit,
    onFocus: () => {
      if (!pageFindActive) {
        setShowSuggestions(true);
      }
    },
    onBlur,
    favoriteButton: {
      visible: pageFindActive === false && activeWebFavoriteUrl !== null,
      active: activeWebFavorite !== undefined,
      label: activeWebFavorite === undefined ? addFavoriteLabel : removeFavoriteLabel,
      onToggle: toggleWebFavorite
    },

    // Autocomplete predictions integration
    suggestions,
    selectedIndex,
    showSuggestions,
    onKeyDown,
    onSuggestionClick: selectSuggestion,
    focusRequestKey,
    pageFindResult,
    onPageFindClose: closePageFind,
    onPageFindNext: () => runPageFind("next"),
    onPageFindPrevious: () => runPageFind("previous"),
    onPageFindMatchClick: selectPageFindMatch
  };
};
