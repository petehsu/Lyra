import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  WorkbenchBrowserPageRuntimeState
} from "../../../../shared/desktop-bridge";
import type { WorkspaceTab, WorkspaceTabsModel } from "../../workspace-tabs";
import { useTitlebarNavigationModel } from "../use-titlebar-navigation-model";

const createTabsModel = (): Pick<
  WorkspaceTabsModel,
  "navigateResolvedInput" | "updateActiveInput"
> => ({
  navigateResolvedInput: vi.fn(() => "browser-tab-1"),
  updateActiveInput: vi.fn()
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

const renderModel = ({
  activeTab,
  activePageRuntimeState = null,
  tabsModel = createTabsModel(),
  onReload = vi.fn()
}: {
  readonly activeTab: WorkspaceTab;
  readonly activePageRuntimeState?: WorkbenchBrowserPageRuntimeState | null;
  readonly tabsModel?: Pick<
    WorkspaceTabsModel,
    "navigateResolvedInput" | "updateActiveInput"
  >;
  readonly onReload?: () => void;
}) => renderHook(() =>
  useTitlebarNavigationModel({
    desktopApi: null,
    activeTab,
    activePageRuntimeState,
    activeFileEditorState: null,
    activeFileManagerState: null,
    tabsModel,
    omniboxNonBrowserSubmitTarget: "new_tab",
    placeholder: "Search",
    ariaLabel: "Address",
    submitLabel: "Go",
    reloadLabel: "Reload page",
    onReload,
    onOpenFilePath: vi.fn(() => null),
    onOpenDirectoryPath: vi.fn()
  })
);

describe("useTitlebarNavigationModel", () => {
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
    expect(tabsModel.navigateResolvedInput).toHaveBeenCalledWith(
      { kind: "search", query: "lyra docs", mode: "standard" },
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
});
