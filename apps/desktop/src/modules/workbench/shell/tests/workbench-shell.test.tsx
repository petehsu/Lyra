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
    searchPayload: null,
    sharedTransitionRect: null,
    onSharedAnimationDone: vi.fn(),
    onSearchSurfaceSubmit: vi.fn(),
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
      if (activeTab.appId === "ai-panel") {
        return <div aria-label="ai-panel-workspace-surface" />;
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

describe("workbench shell", () => {
  beforeEach(() => {
    resetWorkbenchStateStorageForTests();
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

  test("opens ai panel as a new app tab from left panel topbar button", () => {
    render(<WorkbenchShell />);

    fireEvent.click(screen.getByRole("button", { name: "在工作区打开 AI 面板" }));

    expect(screen.getByLabelText("ai-panel-workspace-surface")).toBeInTheDocument();
  });

  test("opens mcp and skills tabs from ai topbar buttons", () => {
    render(<WorkbenchShell />);

    fireEvent.click(screen.getByRole("button", { name: "打开 MCP" }));
    expect(screen.getByLabelText("ai-mcp-surface")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开 Skills" }));
    expect(screen.getByLabelText("ai-skills-surface")).toBeInTheDocument();
  });

  test("applies language and theme changes immediately", () => {
    render(<WorkbenchShell />);

    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));

    fireEvent.click(screen.getByRole("radio", { name: "English (US)" }));

    expect(screen.getByRole("button", { name: "Open Settings" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "One Dark" }));

    const root = document.querySelector(".lyra-root");
    expect(root).not.toBeNull();
    expect((root as HTMLElement).style.getPropertyValue("--lyra-bg-app")).toBe("#3b414d");
  });

  test("renders 9 theme options including system-follow variants", () => {
    render(<WorkbenchShell />);

    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));

    const themeOptions = [
      "One Light",
      "One Dark",
      "One 跟随系统",
      "Ayu Light",
      "Ayu Dark",
      "Ayu 跟随系统",
      "Gruvbox Light",
      "Gruvbox Dark",
      "Gruvbox 跟随系统"
    ];

    for (const option of themeOptions) {
      expect(screen.getByRole("radio", { name: option })).toBeInTheDocument();
    }
  });

  test("persists system theme selection", () => {
    render(<WorkbenchShell />);
    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));

    fireEvent.click(screen.getByRole("radio", { name: "One 跟随系统" }));

    const raw = readWorkbenchStateSync("preferences");
    expect(raw).not.toBeNull();
    expect(raw).toContain("\"theme\":\"one-system\"");
  });

  test("persists terminal theme selection", () => {
    render(<WorkbenchShell />);
    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));

    fireEvent.click(screen.getByRole("radio", { name: "Ocean Matrix" }));

    const raw = readWorkbenchStateSync("preferences");
    expect(raw).not.toBeNull();
    expect(raw).toContain("\"terminalThemePreset\":\"ocean-matrix\"");
  });
});
