import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { WorkspaceTab } from "../../workspace-tabs/types";
import { BrowserTabStrip, type BrowserTabStripProps } from "../tab-strip";

const createTab = (
  id: string,
  title: string,
  pageKind: WorkspaceTab["pageKind"] = "page"
): WorkspaceTab => ({
  id,
  title,
  pageKind,
  inputValue: "",
  displayAddress: "",
  faviconUrl: undefined,
  query: undefined
});

const createProps = (overrides: Partial<BrowserTabStripProps> = {}): BrowserTabStripProps => ({
  tabs: [
    createTab("home", "Home", "search"),
    createTab("docs", "Docs")
  ],
  activeTabId: "home",
  goBackLabel: "Back",
  goForwardLabel: "Forward",
  toggleTabStackLabel: "Stack tabs",
  stackedMode: false,
  canGoBack: true,
  canGoForward: false,
  openNewTabLabel: "New tab",
  closeTabLabel: "Close",
  splitTriggerMode: "right_drag",
  onGoBack: vi.fn(),
  onGoForward: vi.fn(),
  onToggleStackedMode: vi.fn(),
  onActivateTab: vi.fn(),
  onCloseTab: vi.fn(),
  onOpenNewTab: vi.fn(),
  ...overrides
});

type MockDataTransfer = DataTransfer & {
  _store: Record<string, string>;
};

const createDataTransfer = (): MockDataTransfer => {
  const store: Record<string, string> = {};
  const types: string[] = [];
  return {
    _store: store,
    dropEffect: "none",
    effectAllowed: "none",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types,
    clearData: (format?: string) => {
      if (format === undefined) {
        for (const key of Object.keys(store)) {
          delete store[key];
        }
        types.length = 0;
        return;
      }
      delete store[format];
      const nextTypes = Object.keys(store);
      types.length = 0;
      types.push(...nextTypes);
    },
    getData: (format: string) => store[format] ?? "",
    setData: (format: string, data: string) => {
      store[format] = data;
      if (types.includes(format) === false) {
        types.push(format);
      }
    },
    setDragImage: () => undefined
  } as unknown as MockDataTransfer;
};

const mockRect = (
  element: Element,
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">
): void => {
  element.getBoundingClientRect = vi.fn(() => ({
    x: rect.left,
    y: rect.top,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
    toJSON: () => ({})
  } as DOMRect));
};

const fireDragEvent = (
  element: Element,
  type: "dragstart" | "dragover",
  dataTransfer: DataTransfer,
  clientX: number
): void => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  Object.defineProperty(event, "clientX", { value: clientX });
  fireEvent(element, event);
};

describe("BrowserTabStrip", () => {
  test("renders accessible controls and dispatches tab actions", () => {
    const onGoBack = vi.fn();
    const onToggleStackedMode = vi.fn();
    const onActivateTab = vi.fn();
    const onCloseTab = vi.fn();
    const onOpenNewTab = vi.fn();

    render(
      <BrowserTabStrip
        {...createProps({
          onGoBack,
          onToggleStackedMode,
          onActivateTab,
          onCloseTab,
          onOpenNewTab
        })}
      />
    );

    const nav = screen.getByLabelText("browser-tabs");
    const strip = nav.querySelector(".lyra-browser-tab-strip");
    const tabList = nav.querySelector(".lyra-browser-tab-list");
    expect(strip).not.toBeNull();
    expect(tabList).not.toBeNull();
    const tabShapes = nav.querySelectorAll(".lyra-chrome-tab-shape");
    expect(tabShapes).toHaveLength(2);
    expect(nav.querySelector(".lyra-chrome-tab-dividers")).not.toBeNull();
    expect(nav.querySelector(".lyra-chrome-tab-background-svg")).not.toBeNull();
    expect(nav.querySelector(".lyra-browser-tab-item-active .lyra-chrome-tab-shape")).not.toBeNull();
    const newTabButton = within(nav).getByRole("button", { name: "New tab" });
    expect(strip).toContainElement(newTabButton);
    expect(tabList).not.toContainElement(newTabButton);
    expect(strip?.lastElementChild).toBe(newTabButton);

    fireEvent.click(within(nav).getByRole("button", { name: "Back" }));
    fireEvent.click(within(nav).getByRole("button", { name: "Stack tabs" }));
    fireEvent.click(within(nav).getByRole("button", { name: "Docs" }));
    fireEvent.click(within(nav).getByRole("button", { name: "Close-Docs" }));
    fireEvent.click(newTabButton);

    expect(within(nav).getByRole("button", { name: "Forward" })).toBeDisabled();
    expect(onGoBack).toHaveBeenCalledTimes(1);
    expect(onToggleStackedMode).toHaveBeenCalledTimes(1);
    expect(onActivateTab).toHaveBeenCalledWith("docs");
    expect(onCloseTab).toHaveBeenCalledWith("docs");
    expect(onOpenNewTab).toHaveBeenCalledTimes(1);
  });

  test("renders navigation control in a toolbar above the tab strip", () => {
    render(
      <BrowserTabStrip
        {...createProps({
          navigationControl: <div data-testid="navigation-control" />,
          toolbarContextControl: <div data-testid="toolbar-context-control" />
        })}
      />
    );

    const nav = screen.getByLabelText("browser-tabs");
    const strip = nav.querySelector(".lyra-browser-tab-strip") as HTMLElement;
    const toolbar = nav.querySelector(".lyra-browser-tabs-toolbar") as HTMLElement;
    const navigationShell = nav.querySelector(".lyra-browser-tabs-navigation");
    const contextShell = nav.querySelector(".lyra-browser-tabs-toolbar-context");
    expect(nav).toHaveClass("lyra-browser-tabs-with-navigation");
    expect(toolbar).not.toBeNull();
    expect(
      toolbar.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(toolbar.querySelectorAll(".lyra-browser-nav-button")).toHaveLength(3);
    expect(navigationShell).toContainElement(screen.getByTestId("navigation-control"));
    expect(contextShell).toContainElement(screen.getByTestId("toolbar-context-control"));
    expect(strip).not.toContainElement(screen.getByTestId("navigation-control"));
    expect(strip).not.toContainElement(screen.getByTestId("toolbar-context-control"));
  });

  test("keeps collapsed stacked tabs from rendering close buttons", () => {
    render(
      <BrowserTabStrip
        {...createProps({
          stackedMode: true
        })}
      />
    );

    expect(screen.queryByRole("button", { name: "Close-Docs" })).toBeNull();
    expect(screen.getByRole("button", { name: "Docs" })).toHaveClass(
      "lyra-browser-tab-main-collapsed"
    );
  });

  test("marks only the Agent target tab for title scanning", () => {
    render(
      <BrowserTabStrip
        {...createProps({
          activeTabId: "home",
          agentActiveTabId: "docs"
        })}
      />
    );

    const nav = screen.getByLabelText("browser-tabs");
    const homeTab = nav.querySelector('[data-lyra-tab-id="home"]');
    const docsTab = nav.querySelector('[data-lyra-tab-id="docs"]');

    expect(homeTab).toHaveAttribute("data-agent-active", "false");
    expect(homeTab).not.toHaveClass("lyra-browser-tab-item-agent-active");
    expect(docsTab).toHaveAttribute("data-agent-active", "true");
    expect(docsTab).toHaveClass("lyra-browser-tab-item-agent-active");
    expect(docsTab?.querySelector(".lyra-browser-tab-title")).toHaveTextContent("Docs");
  });

  test("falls back to the default icon when a favicon fails to load", () => {
    render(
      <BrowserTabStrip
        {...createProps({
          tabs: [
            createTab("home", "Home", "search"),
            {
              ...createTab("docs", "Docs"),
              faviconUrl: "https://example.invalid/favicon.ico"
            }
          ]
        })}
      />
    );

    const docsButton = screen.getByRole("button", { name: "Docs" });
    const iconSlot = docsButton.querySelector(".lyra-browser-tab-icon");
    const favicon = iconSlot?.querySelector(".lyra-browser-tab-favicon");
    expect(favicon).not.toBeNull();

    fireEvent.error(favicon as HTMLImageElement);

    expect(favicon).toHaveAttribute("data-failed", "true");
    expect(iconSlot?.querySelector(".lyra-browser-tab-favicon-fallback")).not.toBeNull();
  });

  test("marks newly inserted tabs for the short entry animation", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <BrowserTabStrip
        {...createProps({
          tabs: [
            createTab("home", "Home", "search"),
            createTab("docs", "Docs")
          ]
        })}
      />
    );

    rerender(
      <BrowserTabStrip
        {...createProps({
          tabs: [
            createTab("home", "Home", "search"),
            createTab("docs", "Docs"),
            createTab("new", "New")
          ]
        })}
      />
    );

    const nav = screen.getByLabelText("browser-tabs");
    const newTab = nav.querySelector('[data-lyra-tab-id="new"]');
    expect(newTab).toHaveClass("lyra-browser-tab-item-new");

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(newTab).not.toHaveClass("lyra-browser-tab-item-new");
    vi.useRealTimers();
  });

  test("reorders tabs during drag using fixed chrome-tab positions", () => {
    const onReorderTabs = vi.fn();
    render(
      <BrowserTabStrip
        {...createProps({
          onReorderTabs
        })}
      />
    );

    const nav = screen.getByLabelText("browser-tabs");
    const strip = nav.querySelector(".lyra-browser-tab-strip") as HTMLElement;
    const homeTab = nav.querySelector('[data-lyra-tab-id="home"]') as HTMLElement;
    const docsTab = nav.querySelector('[data-lyra-tab-id="docs"]') as HTMLElement;
    const homeButton = within(nav).getByRole("button", { name: "Home" });
    mockRect(strip, {
      left: 100,
      right: 320,
      top: 0,
      bottom: 34,
      width: 220,
      height: 34
    });
    mockRect(homeTab, {
      left: 100,
      right: 190,
      top: 0,
      bottom: 34,
      width: 90,
      height: 34
    });
    mockRect(docsTab, {
      left: 190,
      right: 280,
      top: 0,
      bottom: 34,
      width: 90,
      height: 34
    });

    const dataTransfer = createDataTransfer();
    fireDragEvent(homeButton, "dragstart", dataTransfer, 110);
    expect(dataTransfer._store).toHaveProperty("application/x-lyra-workspace-tab");
    fireDragEvent(nav, "dragover", dataTransfer, 205);

    expect(onReorderTabs).toHaveBeenCalledWith("home", 1);
  });
});
