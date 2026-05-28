import React, { useCallback, useMemo, useState, useEffect } from "react";

import type { LyraDesktopApi, WorkbenchBrowserPageRuntimeState } from "../../../shared/desktop-bridge";
import type { FileEditorAppState } from "../file-editor";
import type { FileManagerAppState } from "../file-manager";
import type { WorkbenchOmniboxNonBrowserSubmitTarget } from "../preferences";
import type { WorkspaceTab, WorkspaceTabsModel } from "../workspace-tabs";
import { resolveWorkbenchNavigationInput } from "./navigation-input";
import type { TitlebarNavigationPrimaryActionKind } from "./titlebar-navigation";

export type OmniboxSuggestion = {
  readonly value: string;
  readonly type: "preset" | "search" | "history";
  readonly label?: string;
};

const DEVELOPER_PRESETS: readonly OmniboxSuggestion[] = [
  { value: "github.com", type: "preset", label: "GitHub" },
  { value: "google.com", type: "preset", label: "Google" },
  { value: "vercel.com", type: "preset", label: "Vercel" },
  { value: "npmjs.com", type: "preset", label: "NPM Registry" },
  { value: "aws.amazon.com", type: "preset", label: "AWS Console" },
  { value: "claude.ai", type: "preset", label: "Anthropic Claude" },
  { value: "chatgpt.com", type: "preset", label: "OpenAI ChatGPT" },
  { value: "gemini.google.com", type: "preset", label: "Google Gemini" },
  { value: "stackoverflow.com", type: "preset", label: "Stack Overflow" }
];

const fetchSearchSuggestions = async (query: string): Promise<string[]> => {
  if (query.trim().length === 0) return [];
  try {
    const res = await fetch(`https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data) && data.length >= 2 && Array.isArray(data[1])) {
      return data[1].map(s => String(s));
    }
  } catch (err) {
    console.error("Failed to fetch suggestions:", err);
  }
  return [];
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
  readonly onOpenFilePath: (path: string) => string | null;
  readonly onOpenDirectoryPath: (path: string) => Promise<void> | void;
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
  onOpenFilePath,
  onOpenDirectoryPath
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
  const value = isBrowserLikeTab(activeTab)
    ? activeTab.inputValue
    : currentDraft ?? contextualValue;
  const activePageAddress =
    activeTab?.pageKind === "page"
      ? activePageRuntimeState?.address ?? activeTab.displayAddress
      : "";
  const primaryActionKind: TitlebarNavigationPrimaryActionKind =
    activeTab?.pageKind === "page" &&
    activePageAddress.length > 0 &&
    value.trim() === activePageAddress
      ? "reload"
      : "submit";
  const isContextualAddress =
    isBrowserLikeTab(activeTab) === false &&
    currentDraft === undefined &&
    contextualValue.trim().length > 0;

  // Search Autocomplete Suggestion Fetching & Debouncing
  useEffect(() => {
    if (value.trim().length === 0) {
      setSuggestions([]);
      setSelectedIndex(-1);
      return;
    }

    const timer = setTimeout(async () => {
      const searchSuggs = await fetchSearchSuggestions(value);

      const matchedPresets = DEVELOPER_PRESETS.filter(
        p => p.value.toLowerCase().includes(value.toLowerCase()) ||
          (p.label && p.label.toLowerCase().includes(value.toLowerCase()))
      );

      const matchedHistory = sessionHistory
        .filter(h => h.toLowerCase().includes(value.toLowerCase()))
        .map(h => ({ value: h, type: "history" as const }));

      const formattedSearchSuggs = searchSuggs.map(s => ({
        value: s,
        type: "search" as const
      }));

      const combined = [...matchedPresets, ...matchedHistory, ...formattedSearchSuggs];

      const seen = new Set<string>();
      const unique = combined.filter(item => {
        if (seen.has(item.value)) return false;
        seen.add(item.value);
        return true;
      }).slice(0, 7);

      setSuggestions(unique);
      setSelectedIndex(-1);
    }, 150);

    return () => clearTimeout(timer);
  }, [value, sessionHistory]);

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

    if (isBrowserLikeTab(activeTab)) {
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
    tabsModel
  ]);

  const onSubmit = useCallback(async (): Promise<void> => {
    if (activeTab === undefined || activeTabId === null) {
      return;
    }

    if (primaryActionKind === "reload") {
      onReload();
      return;
    }

    setShowSuggestions(false);
    const resolution = await resolveWorkbenchNavigationInput(value, desktopApi);
    await executeResolution(resolution);
  }, [
    activeTab,
    activeTabId,
    desktopApi,
    executeResolution,
    primaryActionKind,
    onReload,
    value
  ]);

  const onSuggestionClick = useCallback(async (sug: OmniboxSuggestion) => {
    onChange(sug.value);
    setShowSuggestions(false);
    const resolution = await resolveWorkbenchNavigationInput(sug.value, desktopApi);
    await executeResolution(resolution);
  }, [onChange, desktopApi, executeResolution]);

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
            onChange(selected.value);
            setShowSuggestions(false);
            const resolution = await resolveWorkbenchNavigationInput(selected.value, desktopApi);
            await executeResolution(resolution);
          }
        }
      }
    },
    [showSuggestions, suggestions, selectedIndex, onChange, executeResolution, desktopApi]
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
    placeholder,
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
    onSuggestionClick
  };
};
