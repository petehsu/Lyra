import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../browser-tabs", () => ({
  BrowserTabStrip: () => <nav aria-label="browser-tabs" />
}));

vi.mock("../../terminal-dock", () => ({
  TerminalDock: () => <div aria-label="terminal-dock" />,
  TerminalWorkspaceSurface: () => <div aria-label="terminal-workspace-surface" />,
  useTerminalDockModel: () => ({
    state: { panes: {} },
    activeDockTab: null,
    dockTabs: [],
    activeDockPanes: [],
    openTab: vi.fn(),
    splitActivePane: vi.fn(),
    setActiveTab: vi.fn(),
    closeTab: vi.fn(),
    focusPane: vi.fn(),
    findTab: vi.fn(() => null),
    getTabPanes: vi.fn(() => []),
    moveTabToWorkspace: vi.fn(),
    moveTabToDock: vi.fn(),
    reorderDockTab: vi.fn()
  })
}));

vi.mock("../use-terminal-workspace-actions", () => ({
  useTerminalWorkspaceActions: () => ({
    openTerminalTabInWorkspace: vi.fn(),
    openTerminalTabInDock: vi.fn(),
    onWorkspaceTabContextMenu: vi.fn(),
    onBrowserTabClose: vi.fn(),
    closeTerminalTabEverywhere: vi.fn(),
    openDockTabContextMenu: vi.fn()
  })
}));

vi.mock("../use-browser-search-model", () => ({
  useBrowserSearchModel: () => ({
    isSearching: false,
    searchError: null,
    activeSearchMode: "standard",
    currentResultMode: "standard",
    standardSearchState: {
      query: "",
      queryRequestId: "test",
      web: {
        status: "idle",
        payload: {
          query: "",
          blendedResults: [],
          engineBuckets: [],
          elapsedMs: 0,
          fetchedAt: new Date().toISOString()
        }
      },
      local: {
        status: "idle",
        payload: {
          query: "",
          scopePreset: "home",
          roots: [],
          results: [],
          truncated: false,
          elapsedMs: 0,
          stats: {
            scannedFiles: 0,
            scannedDirs: 0,
            contentScannedFiles: 0,
            matchedFiles: 0,
            skippedUnreadable: 0,
            skippedBinaryOrTooLarge: 0,
            usedIndex: false
          }
        }
      }
    },
    deepSearchState: {
      query: "",
      queryRequestId: "deep-test",
      budgetPreset: "medium",
      status: "idle",
      snapshot: {
        query: "",
        budgetPreset: "medium",
        phase: "bootstrapping",
        nodes: [],
        edges: [],
        web: {
          status: "idle",
          engineBuckets: [],
          blendedCount: 0
        },
        local: {
          status: "idle",
          scopePreset: "home",
          roots: [],
          elapsedMs: 0,
          stats: {
            scannedFiles: 0,
            scannedDirs: 0,
            contentScannedFiles: 0,
            matchedFiles: 0,
            skippedUnreadable: 0,
            skippedBinaryOrTooLarge: 0,
            usedIndex: false
          }
        },
        stats: {
          dedupedResults: 0,
          derivedQueries: 0,
          expansionRounds: 0
        },
        lastUpdatedAt: new Date().toISOString()
      },
      done: false
    },
    sharedTransitionRect: null,
    onSharedAnimationDone: vi.fn(),
    onSearchSurfaceSubmit: vi.fn(),
    onSetActiveSearchMode: vi.fn(),
    onToggleDeepSearch: vi.fn(),
    onCancelDeepSearch: vi.fn(),
    onExpandDeepNode: vi.fn(),
    searchPillRef: { current: null }
  })
}));

vi.mock("../../file-manager", () => ({
  useFileManagerModel: () => ({
    createInstance: () => ({
      appId: "file-manager" as const,
      appInstanceId: "file-manager-test",
      title: "文件管理",
      iconKey: "file-manager-home" as const
    }),
    getState: vi.fn(() => ({ instanceId: "file-manager-test" })),
    ensureInstance: vi.fn(),
    syncTabInstances: vi.fn(),
    syncExternalInstances: vi.fn(),
    openHome: vi.fn(async () => undefined),
    openDirectory: vi.fn(async () => undefined),
    openTrash: vi.fn(async () => undefined),
    goBack: vi.fn(async () => undefined),
    goForward: vi.fn(async () => undefined),
    goUp: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    selectEntry: vi.fn(),
    selectTrashEntry: vi.fn(),
    beginCreateDraft: vi.fn(),
    updateCreateDraft: vi.fn(),
    cancelCreateDraft: vi.fn(),
    commitCreateDraft: vi.fn(async () => undefined),
    moveSelectionToTrash: vi.fn(async () => undefined),
    restoreSelectionFromTrash: vi.fn(async () => undefined),
    emptyTrash: vi.fn(async () => undefined),
    toggleCurrentDirectoryFavorite: vi.fn(async () => undefined),
    openEntryContextMenu: vi.fn(),
    openFavoriteContextMenu: vi.fn(),
    openLocationContextMenu: vi.fn(),
    openRecentLocationContextMenu: vi.fn(),
    openDiskContextMenu: vi.fn(),
    openDeviceContextMenu: vi.fn(),
    openTrashEntryContextMenu: vi.fn(),
    openDirectoryContextMenu: vi.fn(),
    openTrashContextMenu: vi.fn()
  })
}));

vi.mock("../workspace-surface-router", () => ({
  WorkspaceSurfaceRouter: ({
    activeTab,
    settings
  }: {
    activeTab?: { pageKind?: string; appId?: string };
    settings: {
      title: string;
      languageLabel: string;
      themeLabel: string;
      terminalThemeLabel: string;
      localeValue: string;
      themeValue: string;
      terminalThemeValue: string;
      localeOptions: readonly { value: string; label: string }[];
      themeOptions: readonly { value: string; label: string }[];
      terminalThemeOptions: readonly { value: string; label: string }[];
      onLocaleChange: (value: string) => void;
      onThemeChange: (value: string) => void;
      onTerminalThemeChange: (value: string) => void;
    };
  }) => {
    if (activeTab?.pageKind === "settings") {
      return (
        <section aria-label="settings-surface">
          <h2>{settings.title}</h2>
          <div>
            <span>{settings.languageLabel}</span>
            {settings.localeOptions.map((option) => (
              <button
                key={option.value}
                role="radio"
                aria-checked={option.value === settings.localeValue}
                onClick={() => {
                  settings.onLocaleChange(option.value);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div>
            <span>{settings.themeLabel}</span>
            {settings.themeOptions.map((option) => (
              <button
                key={option.value}
                role="radio"
                aria-checked={option.value === settings.themeValue}
                onClick={() => {
                  settings.onThemeChange(option.value);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div>
            <span>{settings.terminalThemeLabel}</span>
            {settings.terminalThemeOptions.map((option) => (
              <button
                key={option.value}
                role="radio"
                aria-checked={option.value === settings.terminalThemeValue}
                onClick={() => {
                  settings.onTerminalThemeChange(option.value);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>
      );
    }
    if (activeTab?.pageKind === "app") {
      if (activeTab.appId === "ai-history") {
        return <div aria-label="ai-history-surface" />;
      }
      if (activeTab.appId === "ai-mcp") {
        return <div aria-label="ai-mcp-surface" />;
      }
      if (activeTab.appId === "ai-skills") {
        return <div aria-label="ai-skills-surface" />;
      }
      if (activeTab.appId === "notification-center") {
        return <div aria-label="notification-center-surface" />;
      }
      return <div aria-label="file-manager-surface" />;
    }
    return <div aria-label="workspace-surface-router" />;
  }
}));

import { WorkbenchShell } from "../index";
import { readWorkbenchStateSync, resetWorkbenchStateStorageForTests } from "../../state-storage";

const setDesktopApiPlatform = (platform: NodeJS.Platform) => {
  const now = Date.now();
  const desktopApi = {
    windowControls: {
      minimize: vi.fn(async () => undefined),
      toggleMaximize: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined)
    },
    appMeta: {
      version: "0.1.0",
      platform,
      isPackaged: false
    },
    shellEvents: {
      onWindowStateChange: vi.fn(() => () => undefined)
    },
    openExternal: vi.fn(async () => false),
    linuxCompat: {
      readStatus: vi.fn(async () => ({
        platform: "linux" as const,
        enabled: false,
        safeMode: false,
        backend: "x11" as const,
        gpuMode: "hardware" as const,
        backendSource: "default" as const,
        gpuSource: "default" as const,
        warnings: [],
        notes: [],
        appliedEnv: {},
        appliedSwitches: {},
        facts: {
          sessionType: "unknown" as const,
          desktop: null,
          waylandDisplay: null,
          x11Display: null,
          isRoot: false
        },
        generatedAt: new Date().toISOString()
      })),
      exportDiagnostics: vi.fn(async () => ({
        ok: true as const,
        filePath: "/tmp/linux-compat.json"
      }))
    },
    search: {
      aggregate: vi.fn(async () => ({
        query: "",
        blendedResults: [],
        engineBuckets: [],
        fetchedAt: new Date().toISOString(),
        elapsedMs: 0
      })),
      local: vi.fn(async () => ({
        query: "",
        scopePreset: "home" as const,
        roots: [],
        results: [],
        truncated: false,
        elapsedMs: 0,
        stats: {
          scannedFiles: 0,
          scannedDirs: 0,
          contentScannedFiles: 0,
          matchedFiles: 0,
          skippedUnreadable: 0,
          skippedBinaryOrTooLarge: 0,
          usedIndex: false
        }
      })),
      startLocalStream: vi.fn(async () => ({
        streamId: "stream-1",
        query: "",
        scopePreset: "home" as const,
        roots: []
      })),
      readLocalStream: vi.fn(async () => ({
        streamId: "stream-1",
        query: "",
        scopePreset: "home" as const,
        roots: [],
        results: [],
        truncated: false,
        elapsedMs: 0,
        stats: {
          scannedFiles: 0,
          scannedDirs: 0,
          contentScannedFiles: 0,
          matchedFiles: 0,
          skippedUnreadable: 0,
          skippedBinaryOrTooLarge: 0,
          usedIndex: false
        },
        done: true
      })),
      cancelLocalStream: vi.fn(async () => ({
        removed: true
      })),
      readIndexStatus: vi.fn(async () => ({
        state: "idle" as const,
        indexedFiles: 0,
        indexedDirs: 0
      })),
      rebuildIndex: vi.fn(async () => ({
        status: {
          state: "ready" as const,
          indexedFiles: 0,
          indexedDirs: 0
        },
        scopePreset: "home" as const,
        roots: []
      })),
      startDeepStream: vi.fn(async () => ({
        streamId: "deep-stream-1",
        snapshot: {
          query: "",
          budgetPreset: "medium" as const,
          phase: "bootstrapping" as const,
          nodes: [],
          edges: [],
          web: {
            status: "loading" as const,
            engineBuckets: [],
            blendedCount: 0
          },
          local: {
            status: "loading" as const,
            scopePreset: "home" as const,
            roots: [],
            elapsedMs: 0,
            stats: {
              scannedFiles: 0,
              scannedDirs: 0,
              contentScannedFiles: 0,
              matchedFiles: 0,
              skippedUnreadable: 0,
              skippedBinaryOrTooLarge: 0,
              usedIndex: false
            }
          },
          stats: {
            dedupedResults: 0,
            derivedQueries: 0,
            expansionRounds: 0
          },
          lastUpdatedAt: new Date().toISOString()
        }
      })),
      readDeepStream: vi.fn(async () => ({
        streamId: "deep-stream-1",
        snapshot: {
          query: "",
          budgetPreset: "medium" as const,
          phase: "completed" as const,
          nodes: [],
          edges: [],
          web: {
            status: "ready" as const,
            engineBuckets: [],
            blendedCount: 0
          },
          local: {
            status: "ready" as const,
            scopePreset: "home" as const,
            roots: [],
            elapsedMs: 0,
            stats: {
              scannedFiles: 0,
              scannedDirs: 0,
              contentScannedFiles: 0,
              matchedFiles: 0,
              skippedUnreadable: 0,
              skippedBinaryOrTooLarge: 0,
              usedIndex: false
            }
          },
          stats: {
            dedupedResults: 0,
            derivedQueries: 0,
            expansionRounds: 0
          },
          lastUpdatedAt: new Date().toISOString()
        },
        done: true
      })),
      cancelDeepStream: vi.fn(async () => ({
        removed: true
      })),
      expandDeepNode: vi.fn(async () => ({
        streamId: "deep-stream-1",
        accepted: true
      }))
    },
    files: {
      readHome: vi.fn(),
      readDirectory: vi.fn(),
      readTrash: vi.fn(),
      createFile: vi.fn(),
      createFolder: vi.fn(),
      moveToTrash: vi.fn(),
      restoreFromTrash: vi.fn(),
      emptyTrash: vi.fn(),
      mountDevice: vi.fn(),
      ejectDevice: vi.fn(),
      readFavorites: vi.fn(async () => ({ favorites: [] })),
      writeFavorites: vi.fn(async (value) => value),
      readRecentLocations: vi.fn(async () => ({ recentLocations: [] })),
      writeRecentLocations: vi.fn(async (value) => value),
      readTextFile: vi.fn(),
      writeTextFile: vi.fn(),
      statFile: vi.fn()
    },
    workbenchBrowser: {
      syncTopology: vi.fn(async () => undefined),
      syncLayout: vi.fn(async () => undefined),
      navigate: vi.fn(async (request) => ({
        address: request.address,
        tabId: request.tabId ?? "browser-tab-test",
        title: request.title ?? null
      })),
      goBack: vi.fn(async () => undefined),
      goForward: vi.fn(async () => undefined),
      reload: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      readPageState: vi.fn(async () => null),
      setElementPickerMode: vi.fn(async () => undefined),
      onEvent: vi.fn(() => () => undefined)
    },
    mcp: {
      readCatalog: vi.fn(async () => []),
      readServers: vi.fn(async () => []),
      readEffectiveServers: vi.fn(async () => ({ servers: [] })),
      createServer: vi.fn(async () => {
        throw new Error("not implemented");
      }),
      updateServer: vi.fn(async () => {
        throw new Error("not implemented");
      }),
      deleteServer: vi.fn(async () => undefined),
      installTemplate: vi.fn(async () => {
        throw new Error("not implemented");
      }),
      validateServer: vi.fn(async () => ({ ok: true, errors: [], warnings: [] })),
      startServer: vi.fn(async () => {
        throw new Error("not implemented");
      }),
      stopServer: vi.fn(async () => {
        throw new Error("not implemented");
      }),
      restartServer: vi.fn(async () => {
        throw new Error("not implemented");
      }),
      readServerIntrospection: vi.fn(async () => ({
        serverId: "test",
        prompts: [],
        resources: [],
        tools: [],
        sampledAt: new Date(now).toISOString()
      })),
      onEvent: vi.fn(() => () => undefined)
    },
    skills: {
      readCatalog: vi.fn(async () => []),
      readInstalled: vi.fn(async () => []),
      readEffectiveSkills: vi.fn(async () => []),
      discoverImportSource: vi.fn(async () => ({ kind: "directory", rootPath: "/tmp" })),
      importSkills: vi.fn(async () => []),
      createLyraSkill: vi.fn(async () => {
        throw new Error("not implemented");
      }),
      updateSkillState: vi.fn(async () => {
        throw new Error("not implemented");
      }),
      deleteSkill: vi.fn(async () => undefined),
      readSkillDetails: vi.fn(async () => null),
      onEvent: vi.fn(() => () => undefined)
    },
    lsp: {
      openDocument: vi.fn(async () => undefined),
      changeDocument: vi.fn(async () => undefined),
      saveDocument: vi.fn(async () => undefined),
      closeDocument: vi.fn(async () => undefined),
      completion: vi.fn(async () => ({ items: [] })),
      onEvent: vi.fn(() => () => undefined)
    },
    terminal: {
      createSession: vi.fn(),
      restoreSessions: vi.fn(async () => []),
      reloadPrompt: vi.fn(async () => ({ applied: false, deferred: true })),
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      closeSession: vi.fn(async () => undefined),
      onData: vi.fn(() => () => undefined),
      onExit: vi.fn(() => () => undefined),
      onError: vi.fn(() => () => undefined)
    },
    workbenchState: {
      readSync: vi.fn(() => null),
      writeSync: vi.fn(),
      removeSync: vi.fn()
    },
    workbenchObservation: {
      registerHandler: vi.fn(() => () => undefined)
    }
  } as any;

  Object.defineProperty(window, "lyraDesktop", {
    configurable: true,
    writable: true,
    value: desktopApi
  });
  return desktopApi;
};

describe("workbench shell", () => {
  beforeEach(() => {
    resetWorkbenchStateStorageForTests();
    Object.defineProperty(window, "lyraDesktop", {
      configurable: true,
      writable: true,
      value: undefined
    });
  });

  test("renders empty frame regions", () => {
    render(<WorkbenchShell />);

    expect(screen.getByLabelText("left-panel")).toBeInTheDocument();
    expect(screen.getByLabelText("左侧输入框")).toBeInTheDocument();
    expect(screen.getByLabelText("workspace")).toBeInTheDocument();
    expect(screen.getByLabelText("bottom-panel")).toBeInTheDocument();
  });

  test("toggles left and terminal panels from titlebar buttons", () => {
    render(<WorkbenchShell />);

    fireEvent.click(screen.getByRole("button", { name: "切换左侧面板" }));
    fireEvent.click(screen.getByRole("button", { name: "切换终端面板" }));

    expect(screen.queryByLabelText("left-panel")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("左侧输入框")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("bottom-panel")).not.toBeInTheDocument();
  });

  test("opens settings surface from titlebar button", () => {
    render(<WorkbenchShell />);

    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));

    expect(screen.getByLabelText("settings-surface")).toBeInTheDocument();
  });

  test("opens file manager as a new app tab from titlebar button", () => {
    render(<WorkbenchShell />);

    fireEvent.click(screen.getByRole("button", { name: "打开文件管理器" }));

    expect(screen.getByLabelText("file-manager-surface")).toBeInTheDocument();
  });

  test("opens notification center from topbar bell", () => {
    render(<WorkbenchShell />);

    fireEvent.click(screen.getByRole("button", { name: "打开通知中心" }));

    expect(screen.getByLabelText("notification-center-surface")).toBeInTheDocument();
  });

  test("opens mcp and skills tabs from ai topbar buttons", () => {
    render(<WorkbenchShell />);

    fireEvent.click(screen.getByRole("button", { name: "打开 MCP" }));
    expect(screen.getByLabelText("ai-mcp-surface")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开 Skills" }));
    expect(screen.getByLabelText("ai-skills-surface")).toBeInTheDocument();
  });

  test("opens history tab from ai topbar button", () => {
    render(<WorkbenchShell />);

    fireEvent.click(screen.getByRole("button", { name: "打开历史对话" }));
    expect(screen.getByLabelText("ai-history-surface")).toBeInTheDocument();
  });

  test("applies language and theme changes immediately", () => {
    render(<WorkbenchShell />);

    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));

    fireEvent.click(screen.getByRole("radio", { name: "English (US)" }));

    expect(screen.getByRole("button", { name: "Open Settings" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Lyra Dark" }));

    const root = document.querySelector(".lyra-root");
    expect(root).not.toBeNull();
    expect((root as HTMLElement).style.getPropertyValue("--lyra-bg-app")).toBe("#3b414d");
  });

  test("renders 15 theme options including system-follow variants", () => {
    render(<WorkbenchShell />);

    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));

    const themeOptions = [
      "Lyra Light",
      "Lyra Dark",
      "Lyra 跟随系统",
      "Nova Light",
      "Nova Dark",
      "Nova 跟随系统",
      "Terra Light",
      "Terra Dark",
      "Terra 跟随系统",
      "Ocean Light",
      "Ocean Dark",
      "Ocean 跟随系统",
      "Eclipse Light",
      "Eclipse Dark",
      "Eclipse 跟随系统"
    ];

    for (const option of themeOptions) {
      expect(screen.getByRole("radio", { name: option })).toBeInTheDocument();
    }
  });

  test("persists system theme selection", () => {
    render(<WorkbenchShell />);
    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));

    fireEvent.click(screen.getByRole("radio", { name: "Lyra 跟随系统" }));

    const raw = readWorkbenchStateSync("preferences");
    expect(raw).not.toBeNull();
    expect(raw).toContain("\"theme\":\"lyra-system\"");
  });

  test("persists terminal theme selection", () => {
    render(<WorkbenchShell />);
    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));

    fireEvent.click(screen.getByRole("radio", { name: "Lyra 开发者" }));

    const raw = readWorkbenchStateSync("preferences");
    expect(raw).not.toBeNull();
    expect(raw).toContain("\"terminalThemePreset\":\"lyra-developer\"");
  });

  test("hides custom macOS window buttons when platform is darwin", () => {
    setDesktopApiPlatform("darwin");
    render(<WorkbenchShell />);

    expect(screen.queryByRole("button", { name: "最小化" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "最大化切换" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
  });

  test("renders custom window buttons on non-mac platforms", () => {
    setDesktopApiPlatform("linux");
    render(<WorkbenchShell />);

    expect(screen.getByRole("button", { name: "最小化" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "最大化切换" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  });

  test("shows element picker only on active page tabs and toggles browser mode", async () => {
    const desktopApi = setDesktopApiPlatform("linux");
    render(<WorkbenchShell />);

    expect(screen.queryByRole("button", { name: /开启元素选择器/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开官方文档" }));

    const pickerButton = await screen.findByRole("button", { name: /开启元素选择器/ });
    fireEvent.click(pickerButton);

    expect(desktopApi.workbenchBrowser.setElementPickerMode).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: expect.any(String),
        enabled: true,
        appearance: expect.any(Object)
      })
    );
  });
});
