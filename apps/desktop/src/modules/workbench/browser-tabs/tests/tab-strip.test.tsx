import { fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(strip).not.toBeNull();
    const tabShapes = nav.querySelectorAll(".lyra-chrome-tab-shape");
    expect(tabShapes).toHaveLength(2);
    expect(nav.querySelector(".lyra-chrome-tab-dividers")).not.toBeNull();
    expect(nav.querySelector(".lyra-chrome-tab-background-svg")).not.toBeNull();
    expect(nav.querySelector(".lyra-browser-tab-item-active .lyra-chrome-tab-shape")).not.toBeNull();
    const newTabButton = within(nav).getByRole("button", { name: "New tab" });
    expect(strip).toContainElement(newTabButton);
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

  test("renders navigation control on the right side of the tab strip", () => {
    render(
      <BrowserTabStrip
        {...createProps({
          navigationControl: <div data-testid="navigation-control" />
        })}
      />
    );

    const nav = screen.getByLabelText("browser-tabs");
    const navigationShell = nav.querySelector(".lyra-browser-tabs-navigation");
    expect(nav).toHaveClass("lyra-browser-tabs-with-navigation");
    expect(navigationShell).toContainElement(screen.getByTestId("navigation-control"));
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
});
