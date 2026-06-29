import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  AgentSessionSummary,
  LyraDesktopApi,
  WorkbenchBrowserPageRuntimeState
} from "../../../../shared/desktop-bridge";
import type { WorkspaceTab, WorkspaceTabsModel } from "../../workspace-tabs";
import type { SearchEngineDefinition } from "../../browser-search";
import {
  parseOpenSearchSuggestionPayload,
  useTitlebarNavigationModel
} from "../use-titlebar-navigation-model";

const createTabsModel = (): Pick<
  WorkspaceTabsModel,
  "navigateResolvedInput" | "updateActiveInput" | "openWebSearchTabs"
> => ({
  navigateResolvedInput: vi.fn(() => "browser-tab-1"),
  updateActiveInput: vi.fn(),
  openWebSearchTabs: vi.fn(() => ["browser-tab-1"])
});

const createPageTab = (overrides: Partial<WorkspaceTab> = {}): WorkspaceTab => ({
  id: "browser-tab-1",
  title: "Example",
  pageKind: "page",
  inputValue: "https://example.com/",
  displayAddress: "https://example.com/",
  faviconUrl: undefined,
  query: undefined,
  ...overrides
});

const createRuntimeState = (
  overrides: Partial<WorkbenchBrowserPageRuntimeState> = {}
): WorkbenchBrowserPageRuntimeState => ({
  tabId: "browser-tab-1",
  address: "https://example.com/",
  title: "Example",
  isActive: true,
  isVisible: true,
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  isHtmlFullscreen: false,
  updatedAt: 100,
  ...overrides
});

const createPageFindResult = (query: string, currentIndex = 1) => ({
  tabId: "browser-tab-1",
  address: "https://example.com/",
  title: "Example",
  query,
  currentIndex,
  activeMatchId: query.length === 0 ? undefined : `match-${currentIndex}`,
  totalMatches: query.length === 0 ? 0 : 3,
  matches: query.length === 0
    ? []
    : [
      {
        id: `match-${currentIndex}`,
        index: currentIndex,
        startChar: 4,
        endChar: 4 + query.length,
        snippet: `Example ${query} snippet`
      }
    ],
  truncated: false
});

const renderModel = ({
  activeTab,
  desktopApi = null,
  activePageRuntimeState = null,
  tabsModel = createTabsModel(),
  onReload = vi.fn(),
  onHistoryAppReload,
  onHistoryAppSuggestionSelect,
  onRunTerminalCommand,
  searchEngines = [
    {
      id: "google",
      label: "Google",
      accentColor: "#4285F4",
      searchUrlTemplate: "https://www.google.com/search?q={searchTerms}"
    }
  ],
  autoSearchEngines = searchEngines
}: {
  readonly activeTab: WorkspaceTab;
  readonly desktopApi?: LyraDesktopApi | null;
  readonly activePageRuntimeState?: WorkbenchBrowserPageRuntimeState | null;
  readonly tabsModel?: Pick<
    WorkspaceTabsModel,
    "navigateResolvedInput" | "updateActiveInput" | "openWebSearchTabs"
  >;
  readonly onReload?: () => void;
  readonly onHistoryAppReload?: () => void;
  readonly onHistoryAppSuggestionSelect?: Parameters<typeof useTitlebarNavigationModel>[0]["onHistoryAppSuggestionSelect"];
  readonly onRunTerminalCommand?: (command: string) => void;
  readonly searchEngines?: readonly SearchEngineDefinition[];
  readonly autoSearchEngines?: readonly SearchEngineDefinition[];
}) => renderHook(() =>
  useTitlebarNavigationModel({
    desktopApi,
    activeTab,
    activePageRuntimeState,
    activeFileEditorState: null,
    activeFileManagerState: null,
    searchEngines,
    autoSearchEngines,
    tabsModel,
    omniboxNonBrowserSubmitTarget: "new_tab",
    placeholder: "Search",
    ariaLabel: "Address",
    submitLabel: "Go",
    reloadLabel: "Reload page",
    addFavoriteLabel: "Add Favorite",
    removeFavoriteLabel: "Remove Favorite",
    onReload,
    historyAppPlaceholder: "Search history",
    historyAppSuggestionLabels: {
      sessions: "Sessions",

      archivedSessions: "Archived sessions",
      browserHistory: "Web history"
    },
    ...(onHistoryAppReload ? { onHistoryAppReload } : {}),
    ...(onHistoryAppSuggestionSelect ? { onHistoryAppSuggestionSelect } : {}),
    onOpenFilePath: vi.fn(() => null),
    onOpenDirectoryPath: vi.fn(),
    ...(onRunTerminalCommand ? { onRunTerminalCommand } : {})
  })
);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useTitlebarNavigationModel", () => {
  test("parses OpenSearch suggestion payloads", () => {
    expect(
      parseOpenSearchSuggestionPayload([
        "lyra",
        ["lyra browser", "", " lyra desktop "],
        [],
        []
      ])
    ).toEqual(["lyra browser", "lyra desktop"]);
    expect(parseOpenSearchSuggestionPayload({ suggestions: ["lyra"] })).toEqual([]);
  });

  test("builds suggestions from OpenSearch providers without hardcoded presets", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("wikipedia.org")) {
        return {
          ok: true,
          json: async () => ["git", ["Git", "GitHub Actions"], [], []]
        } as Response;
      }
      return {
        ok: true,
        json: async () => ["git", ["git status", "github"], [], []]
      } as Response;
    });

    const { result } = renderModel({
      activeTab: createPageTab({
        inputValue: "git"
      }),
      activePageRuntimeState: createRuntimeState()
    });

    act(() => {
      result.current.onFocus();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("suggestqueries.google.com"))).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("wikipedia.org"))).toBe(true);
    expect(result.current.suggestions).toEqual([
      { value: "git status", type: "search", label: "Google" },
      { value: "github", type: "search", label: "Google" },
      { value: "Git", type: "search", label: "Wikipedia" },
      { value: "GitHub Actions", type: "search", label: "Wikipedia" }
    ]);
    expect(
      result.current.suggestions.some(
        (suggestion) => (suggestion as { readonly type: string }).type === "preset"
      )
    ).toBe(false);
  });

  test("reloads the active page when the address input is unchanged", async () => {
    const tabsModel = createTabsModel();
    const onReload = vi.fn();
    const { result } = renderModel({
      activeTab: createPageTab(),
      activePageRuntimeState: createRuntimeState(),
      tabsModel,
      onReload
    });

    expect(result.current.primaryActionKind).toBe("reload");

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(tabsModel.navigateResolvedInput).not.toHaveBeenCalled();
  });

  test("toggles the active web page favorite through file-manager favorites", async () => {
    let favorites: NonNullable<Awaited<ReturnType<LyraDesktopApi["files"]["readFavorites"]>>>["favorites"] = [];
    const readFavorites = vi.fn(async () => ({ favorites }));
    const writeFavorites = vi.fn(async (payload: { readonly favorites: typeof favorites }) => {
      favorites = payload.favorites;
      return { favorites };
    });
    const { result } = renderModel({
      activeTab: createPageTab(),
      activePageRuntimeState: createRuntimeState({
        title: "Example",
        faviconUrl: "https://example.com/favicon.ico"
      }),
      desktopApi: {
        files: {
          readFavorites,
          writeFavorites
        }
      } as unknown as LyraDesktopApi
    });

    await waitFor(() => expect(readFavorites).toHaveBeenCalled());
    expect(result.current.favoriteButton).toMatchObject({
      visible: true,
      active: false,
      label: "Add Favorite"
    });

    act(() => {
      result.current.favoriteButton.onToggle();
    });

    await waitFor(() => expect(writeFavorites).toHaveBeenCalled());
    expect(favorites[0]).toEqual(expect.objectContaining({
      kind: "web",
      title: "Example",
      path: "https://example.com/",
      url: "https://example.com/",
      faviconUrl: "https://example.com/favicon.ico"
    }));
  });

  test("submits navigation when a page address has changed", async () => {
    const tabsModel = createTabsModel();
    const onReload = vi.fn();
    const { result } = renderModel({
      activeTab: createPageTab({
        inputValue: "https://example.com/docs"
      }),
      activePageRuntimeState: createRuntimeState(),
      tabsModel,
      onReload
    });

    expect(result.current.primaryActionKind).toBe("submit");

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(onReload).not.toHaveBeenCalled();
    expect(tabsModel.navigateResolvedInput).toHaveBeenCalledWith(
      { kind: "page", address: "https://example.com/docs" },
      { target: "active-tab" }
    );
  });

  test("does not reload search result tabs even when their input is unchanged", async () => {
    const tabsModel = createTabsModel();
    const onReload = vi.fn();
    const { result } = renderModel({
      activeTab: createPageTab({
        pageKind: "results",
        inputValue: "lyra docs",
        displayAddress: "lyra://search?q=lyra%20docs",
        query: "lyra docs"
      }),
      tabsModel,
      onReload
    });

    expect(result.current.primaryActionKind).toBe("submit");

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(onReload).not.toHaveBeenCalled();
    expect(tabsModel.openWebSearchTabs).toHaveBeenCalledWith(
      {
        query: "lyra docs",
        targets: [{
          address: "https://www.google.com/search?q=lyra%20docs",
          engineId: "google",
          title: "Google"
        }],
        selection: { mode: "auto", engineIds: [] }
      },
      { target: "active-tab" }
    );
  });

  test("uses automatic search engines for plain titlebar searches independently of registered buttons", async () => {
    const tabsModel = createTabsModel();
    const resolveWebSearchEngine = vi.fn(async (request: {
      readonly engines: readonly SearchEngineDefinition[];
    }) => ({
      engine: request.engines[0]!,
      searchUrl: "https://www.google.com/search?q=lyra%20docs",
      fallbackUsed: false
    }));
    const { result } = renderModel({
      activeTab: createPageTab({
        inputValue: "lyra docs"
      }),
      desktopApi: {
        search: {
          resolveWebSearchEngine
        }
      } as unknown as LyraDesktopApi,
      tabsModel,
      searchEngines: [
        {
          id: "bing",
          label: "Bing",
          accentColor: "#008373",
          searchUrlTemplate: "https://www.bing.com/search?q={searchTerms}"
        }
      ],
      autoSearchEngines: [
        {
          id: "google",
          label: "Google",
          accentColor: "#4285F4",
          searchUrlTemplate: "https://www.google.com/search?q={searchTerms}"
        }
      ]
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(resolveWebSearchEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        engines: [
          expect.objectContaining({
            id: "google"
          })
        ]
      })
    );
    expect(tabsModel.openWebSearchTabs).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [
          expect.objectContaining({
            engineId: "google"
          })
        ]
      }),
      { target: "active-tab" }
    );
  });

  test("keeps app context submissions on submit primary action", () => {
    const { result } = renderModel({
      activeTab: createPageTab({
        pageKind: "app",
        inputValue: "",
        displayAddress: "lyra://app/file-editor/file-1",
        appId: "file-editor",
        appInstanceId: "file-1",
        appIconKey: "file-editor-code",
        filePath: "/tmp/example.txt"
      })
    });

    expect(result.current.value).toBe("/tmp/example.txt");
    expect(result.current.primaryActionKind).toBe("submit");
  });

  test("uses the app tab input as the history surface query and reloads history on submit", async () => {
    const tabsModel = createTabsModel();
    const onHistoryAppReload = vi.fn();
    const { result } = renderModel({
      activeTab: createPageTab({
        pageKind: "app",
        inputValue: "project",
        displayAddress: "lyra://app/agent-session-history/agent-session-history",
        appId: "agent-session-history",
        appInstanceId: "agent-session-history",
        appIconKey: "agent-session-history-default"
      }),
      tabsModel,
      onHistoryAppReload
    });

    expect(result.current.value).toBe("project");
    expect(result.current.placeholder).toBe("Search history");
    expect(result.current.primaryActionKind).toBe("reload");

    act(() => {
      result.current.onChange("archived");
    });
    expect(tabsModel.updateActiveInput).toHaveBeenCalledWith("archived");

    await act(async () => {
      await result.current.onSubmit();
    });
    expect(onHistoryAppReload).toHaveBeenCalledTimes(1);
    expect(tabsModel.navigateResolvedInput).not.toHaveBeenCalled();
  });

  test("expands history surface matches in the omnibox and selects them without navigation", async () => {
    vi.useFakeTimers();
    const sessions: AgentSessionSummary[] = [
      {
        id: "session-1",
        title: "Fix agent storage",
        customTitle: null,
        shortName: "storage",
        status: "idle",
        providerKey: "openai",
        providerLabel: "OpenAI",
        model: "gpt-5",
        messageCount: 3,
        createdAt: "2026-05-15T00:00:00Z",
        updatedAt: "2026-05-15T00:05:00Z",
        lastActiveAt: "2026-05-15T00:05:00Z",
        saved: false,
        saveLabel: null,
        archived: false,
        workingDir: "/Users/petehsu/Documents/Lyra"
      }
    ];
    const listSessions = vi.fn(async () => ({
      sessionsDir: "/tmp/sessions",
      sessions
    }));
    const tabsModel = createTabsModel();
    const onHistoryAppSuggestionSelect = vi.fn();
    const { result } = renderModel({
      activeTab: createPageTab({
        pageKind: "app",
        inputValue: "storage",
        displayAddress: "lyra://app/agent-session-history/agent-session-history",
        appId: "agent-session-history",
        appInstanceId: "agent-session-history",
        appIconKey: "agent-session-history-default"
      }),
      desktopApi: {
        agent: {
          listSessions
        }
      } as unknown as LyraDesktopApi,
      tabsModel,
      onHistoryAppSuggestionSelect
    });

    act(() => {
      result.current.onFocus();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(result.current.suggestions).toEqual([
      {
        value: "Fix agent storage",
        type: "history",
        label: "Sessions",
        historyTarget: {
          kind: "session",
          sessionId: "session-1",
          category: "sessions"
        }
      }
    ]);

    await act(async () => {
      await result.current.onSuggestionClick(result.current.suggestions[0]!);
    });

    expect(tabsModel.updateActiveInput).toHaveBeenCalledWith("Fix agent storage");
    expect(onHistoryAppSuggestionSelect).toHaveBeenCalledWith({
      kind: "session",
      sessionId: "session-1",
      category: "sessions"
    });
    expect(tabsModel.navigateResolvedInput).not.toHaveBeenCalled();
  });

  test("runs prefixed commands in a terminal task from the titlebar", async () => {
    const tabsModel = createTabsModel();
    const onRunTerminalCommand = vi.fn();
    const { result } = renderModel({
      activeTab: createPageTab({
        inputValue: "> npm test"
      }),
      tabsModel,
      onRunTerminalCommand
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(onRunTerminalCommand).toHaveBeenCalledWith("npm test");
    expect(tabsModel.navigateResolvedInput).not.toHaveBeenCalled();
  });

  test("opens page find from the browser find shortcut and clears the omnibox value", () => {
    const searchInPage = vi.fn(async ({ query }: { readonly query: string }) =>
      createPageFindResult(query)
    );
    const { result } = renderModel({
      activeTab: createPageTab(),
      activePageRuntimeState: createRuntimeState(),
      desktopApi: {
        workbenchBrowser: {
          searchInPage,
          setChromePopover: vi.fn(async () => undefined),
          onEvent: vi.fn(() => () => undefined)
        }
      } as unknown as LyraDesktopApi
    });

    expect(result.current.mode).toBe("normal");
    expect(result.current.value).toBe("https://example.com/");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "f",
        ctrlKey: true,
        bubbles: true
      }));
    });

    expect(result.current.mode).toBe("page-find");
    expect(result.current.value).toBe("");
    expect(result.current.showSuggestions).toBe(false);
    expect(searchInPage).toHaveBeenCalledWith({
      tabId: "browser-tab-1",
      query: ""
    });
  });

  test("runs page-find queries instead of normal navigation while in page-find mode", async () => {
    vi.useFakeTimers();
    const tabsModel = createTabsModel();
    const searchInPage = vi.fn(async (request: { readonly query: string; readonly direction?: string }) =>
      createPageFindResult(request.query, request.direction === "next" ? 2 : 1)
    );
    const { result } = renderModel({
      activeTab: createPageTab(),
      activePageRuntimeState: createRuntimeState(),
      tabsModel,
      desktopApi: {
        workbenchBrowser: {
          searchInPage,
          setChromePopover: vi.fn(async () => undefined),
          onEvent: vi.fn(() => () => undefined)
        }
      } as unknown as LyraDesktopApi
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "f",
        metaKey: true,
        bubbles: true
      }));
    });
    expect(result.current.mode).toBe("page-find");
    await act(async () => {
      result.current.onChange("Lyra");
    });
    expect(result.current.value).toBe("Lyra");
    expect(tabsModel.updateActiveInput).not.toHaveBeenCalledWith("Lyra");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(searchInPage).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-1",
        query: "Lyra",
        direction: "current",
        reveal: true
      })
    );

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(searchInPage).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-1",
        query: "Lyra",
        direction: "next",
        reveal: true
      })
    );

    await act(async () => {
      await result.current.onPageFindMatchClick(7);
    });

    expect(searchInPage).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-1",
        query: "Lyra",
        activeIndex: 7,
        direction: "current",
        reveal: true
      })
    );
    expect(tabsModel.navigateResolvedInput).not.toHaveBeenCalled();
  });
});
