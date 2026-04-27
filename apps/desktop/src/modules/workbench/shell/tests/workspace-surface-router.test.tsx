import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { WorkbenchSurfaceAdapters } from "../../ui-platform";
import type { WorkspaceTab } from "../../workspace-tabs";
import type { WorkspaceSurfaceRouterProps } from "../workspace-surface-router";
import { WorkspaceSurfaceRouter } from "../workspace-surface-router";

const createTab = (
  overrides: Partial<WorkspaceTab>
): WorkspaceTab => ({
  id: "tab-1",
  title: "Tab",
  pageKind: "settings",
  inputValue: "",
  displayAddress: "",
  faviconUrl: undefined,
  query: undefined,
  ...overrides
});

const createSurfaceAdapters = (): WorkbenchSurfaceAdapters => ({
  searchHome: () => <div aria-label="fake-search-home" />,
  searchResults: () => <div aria-label="fake-search-results" />,
  deepSearchResults: () => <div aria-label="fake-deep-search-results" />,
  browserPage: () => <div aria-label="fake-browser-page" />,
  settings: ({ title }) => <div aria-label="fake-settings">{title}</div>,
  terminalWorkspace: ({ tab }) => <div aria-label="fake-terminal-workspace">{tab.title}</div>,
  fileManager: ({ state }) => (
    <div aria-label="fake-file-manager">{state?.currentLocation?.path ?? "missing"}</div>
  ),
  fileEditor: () => <div aria-label="fake-file-editor" />,
  notificationCenter: () => <div aria-label="fake-notification-center" />,
  mcpCenter: () => <div aria-label="fake-mcp-center" />,
  skillsCenter: () => <div aria-label="fake-skills-center" />,
  aiHistory: () => <div aria-label="fake-ai-history" />
});

const createProps = (
  tab: WorkspaceTab,
  overrides: Partial<WorkspaceSurfaceRouterProps> = {}
): WorkspaceSurfaceRouterProps => ({
  surfaceAdapters: createSurfaceAdapters(),
  activeTab: tab,
  tabsModel: {
    tabs: [tab],
    activeTabId: tab.id,
    activeTab: tab,
    splitGroupTabIds: [],
    focusedSplitTabId: null,
    getVisibleWorkspaceLayout: () => ({
      mode: "single",
      activeTabId: tab.id,
      visibleTabIds: [tab.id],
      splitGroupTabIds: [],
      focusedSplitTabId: null
    }),
    setActiveTab: vi.fn(),
    updateActiveInput: vi.fn(),
    commitActiveInput: vi.fn()
  },
  logoUrl: "/logo.svg",
  browserSearchModel: {
    activeSearchMode: "standard",
    isSearching: false,
    searchError: null,
    sharedTransitionRect: null,
    searchPillRef: { current: null },
    standardSearchState: {},
    deepSearchState: { snapshot: {} },
    onSearchSurfaceSubmit: vi.fn(),
    onToggleDeepSearch: vi.fn(),
    onCancelDeepSearch: vi.fn(),
    onExpandDeepNode: vi.fn(),
    onSharedAnimationDone: vi.fn()
  },
  engineById: new Map(),
  onOpenSearchResult: vi.fn(),
  onPageHostChange: vi.fn(),
  terminalModel: {
    findTab: vi.fn(() => ({ id: "term-1", title: "Terminal", placement: "workspace" })),
    getTabPanes: vi.fn(() => []),
    focusPane: vi.fn()
  },
  desktopApi: null,
  terminalLabels: {},
  terminalThemeSignature: "test",
  terminalThemePreset: "follow-app",
  resolvedThemeId: "lyra-light",
  fileManagerModel: {
    getState: vi.fn(() => ({ currentLocation: { path: "/tmp" } }))
  },
  fileManagerLabels: {},
  resolveFileManagerChooser: vi.fn(() => null),
  fileEditorModel: {
    getState: vi.fn(() => null)
  },
  fileEditorLabels: {},
  onOpenFileFromManager: vi.fn(),
  onRevealPathInFileManager: vi.fn(),
  splitThreePaneLayout: "adaptive",
  settings: {
    title: "Settings",
    deepSearchRestoreViewportValue: false,
    deepSearchLocalOpenBehaviorValue: "open_file"
  },
  searchResultsSourceFilter: "all",
  onSearchResultsSourceFilterChange: vi.fn(),
  i18n: {},
  mcpCenter: { model: {}, labels: {} },
  skillsCenter: { model: {}, labels: {} },
  aiHistory: {
    locale: "en-US",
    title: "History",
    newSessionTitle: "New",
    newConversationLabel: "New",
    openConversationLabel: "Open",
    deleteConversationLabel: "Delete",
    archiveConversationLabel: "Archive",
    archivedConversationLabel: "Archived",
    archivedProjectLabel: "Archived project",
    deleteArchivedConversationTitle: "Delete",
    deleteArchivedConversationDescription: "Delete",
    deleteArchivedConversationConfirm: "Delete",
    deleteArchivedConversationCancel: "Cancel",
    profileLabel: "Profile",
    sessionIdLabel: "Session",
    loadingSessionsLabel: "Loading",
    emptyStateTitle: "Empty",
    emptyStateDescription: "Empty",
    scopeGlobalLabel: "Global",
    scopeProjectLabel: "Project",
    noProjectSessionsEmptyLabel: "None",
    noProjectsEmptyLabel: "None",
    projectSessionCountLabel: "sessions",
    backToProjectsLabel: "Back",
    projectPathLabel: "Path",
    threadPreviewEmptyLabel: "Empty",
    previewEmptyTitle: "Empty",
    previewEmptyDescription: "Empty",
    previewLoadingLabel: "Loading"
  },
  notifications: {
    model: {
      notifications: [],
      selectedNotificationId: null,
      selectNotification: vi.fn(),
      markAllNotificationsRead: vi.fn()
    },
    labels: {},
    onOpenNotificationSource: vi.fn(),
    onRequestClearAll: vi.fn()
  },
  ...overrides
} as unknown as WorkspaceSurfaceRouterProps);

describe("WorkspaceSurfaceRouter", () => {
  test("delegates settings tabs to the injected settings surface adapter", () => {
    render(<WorkspaceSurfaceRouter {...createProps(createTab({ pageKind: "settings" }))} />);

    expect(screen.getByLabelText("fake-settings")).toHaveTextContent("Settings");
  });

  test("delegates terminal tabs to the injected terminal workspace adapter", () => {
    render(
      <WorkspaceSurfaceRouter
        {...createProps(createTab({ pageKind: "terminal", terminalTabId: "term-1" }))}
      />
    );

    expect(screen.getByLabelText("fake-terminal-workspace")).toHaveTextContent("Terminal");
  });

  test("delegates file manager app tabs to the injected file manager adapter", () => {
    render(
      <WorkspaceSurfaceRouter
        {...createProps(createTab({
          pageKind: "app",
          appId: "file-manager",
          appInstanceId: "fm-1"
        }))}
      />
    );

    expect(screen.getByLabelText("fake-file-manager")).toHaveTextContent("/tmp");
  });
});
