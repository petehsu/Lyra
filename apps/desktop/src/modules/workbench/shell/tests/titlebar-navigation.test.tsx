import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { TitlebarNavigation } from "../titlebar-navigation";

const createRect = (
  left: number,
  top: number,
  width: number,
  height: number
): DOMRect => ({
  x: left,
  y: top,
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  toJSON: () => ({})
} as DOMRect);

const renderNavigation = (
  overrides: Partial<Parameters<typeof TitlebarNavigation>[0]> = {}
) => {
  const onSubmit = vi.fn();
  const onChange = vi.fn();

  render(
    <TitlebarNavigation
      value="https://example.com/"
      placeholder="Search"
      ariaLabel="Address"
      submitLabel="Go"
      reloadLabel="Reload page"
      primaryActionKind="submit"
      isContextualAddress={false}
      onChange={onChange}
      onSubmit={onSubmit}
      onFocus={vi.fn()}
      onBlur={vi.fn()}
      {...overrides}
    />
  );

  return { onChange, onSubmit };
};

describe("TitlebarNavigation", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("uses the submit label for the default primary action", () => {
    const { onSubmit } = renderNavigation();

    const button = screen.getByRole("button", { name: "Go" });
    expect(button).toHaveAttribute("title", "Go");
    expect(button.closest(".lyra-titlebar-navigation-shell")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Clear Address|清除 Address/u })).toBeNull();

    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("uses the reload label and icon for reload primary action", () => {
    const { onSubmit } = renderNavigation({
      primaryActionKind: "reload"
    });

    const button = screen.getByRole("button", { name: "Reload page" });
    expect(button).toHaveAttribute("title", "Reload page");
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.closest(".lyra-titlebar-navigation-shell")).toBeNull();
    expect(button.closest(".lyra-titlebar-navigation-external-actions")).not.toBeNull();

    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("animates the reload action after clicking it", async () => {
    vi.useFakeTimers();
    renderNavigation({
      primaryActionKind: "reload"
    });

    const button = screen.getByRole("button", { name: "Reload page" });
    fireEvent.click(button);

    await act(async () => {
      await vi.advanceTimersToNextTimerAsync();
    });

    expect(button).toHaveClass("lyra-titlebar-navigation-action-reloading");
  });

  test("renders omnibox suggestions inside the navigation shell so the input stretches upward", () => {
    const onSuggestionClick = vi.fn();
    renderNavigation({
      showSuggestions: true,
      selectedIndex: 1,
      onSuggestionClick,
      suggestions: [
        { type: "search", value: "github", label: "Google" },
        { type: "search", value: "github actions", label: "Wikipedia" }
      ]
    });

    const listbox = screen.getByRole("listbox", { name: "地址建议" });
    const shell = listbox.closest(".lyra-titlebar-navigation-shell");

    expect(listbox.closest("form")).not.toBeNull();
    expect(shell).not.toBeNull();
    expect(shell).toHaveAttribute("data-suggestions-open", "true");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.mouseDown(screen.getByText("github actions (Wikipedia)"));
    expect(onSuggestionClick).toHaveBeenCalledWith(
      expect.objectContaining({ value: "github actions" })
    );
  });

  test("ports security details and flips them away from the viewport edge", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 900
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 520
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getMockRect(this: HTMLElement) {
        const element = this;
        if (element.classList.contains("lyra-titlebar-navigation-security-btn")) {
          return createRect(40, 480, 28, 28);
        }
        if (element.classList.contains("lyra-omnibox-security-popover")) {
          return createRect(0, 0, 300, 240);
        }
        return createRect(40, 480, 420, 28);
      });

    renderNavigation();
    fireEvent.click(screen.getByTitle("查看连接安全信息"));

    const popover = screen.getByRole("dialog", { name: "连接安全信息" });
    expect(popover.closest("form")).toBeNull();
    expect(popover).toHaveAttribute("data-placement", "top");
    expect(popover).toHaveStyle({ position: "fixed" });
    expect(Number.parseInt(popover.style.top, 10)).toBeLessThan(480);
    expect(Number.parseInt(popover.style.left, 10)).toBeGreaterThanOrEqual(8);
  });

  test("routes browser security details through the native browser popover layer", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 900
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 520
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getMockRect(this: HTMLElement) {
        const element = this;
        if (element.classList.contains("lyra-titlebar-navigation-security-btn")) {
          return createRect(40, 28, 28, 28);
        }
        return createRect(40, 28, 420, 28);
      });
    const setChromePopover = vi.fn(async () => undefined);

    renderNavigation({
      activeBrowserTabId: "browser-tab-1",
      browserChromePopoverBridge: { setChromePopover }
    });
    fireEvent.click(screen.getByTitle("查看连接安全信息"));

    expect(screen.queryByRole("dialog", { name: "连接安全信息" })).toBeNull();
    expect(setChromePopover).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-1",
        kind: "security",
        visible: true,
        security: expect.objectContaining({
          level: "secure",
          locale: "zh-CN",
          domain: "example.com",
          scheme: "https",
          origin: "https://example.com",
          certificateStatus: "unavailable",
          certificateUnavailableReason: "当前界面无法读取证书链。"
        })
      })
    );

    fireEvent.click(screen.getByTitle("查看连接安全信息"));
    expect(setChromePopover).toHaveBeenLastCalledWith({
      tabId: "browser-tab-1",
      kind: "security",
      visible: false
    });
  });

  test("syncs native browser popover close events back into the titlebar button state", () => {
    const listeners = new Set<(event: any) => void>();
    const setChromePopover = vi.fn(async () => undefined);

    renderNavigation({
      activeBrowserTabId: "browser-tab-1",
      browserChromePopoverBridge: {
        setChromePopover,
        onEvent: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      }
    });
    fireEvent.click(screen.getByTitle("查看连接安全信息"));
    expect(setChromePopover).toHaveBeenCalledTimes(1);

    act(() => {
      for (const listener of listeners) {
        listener({
          kind: "chrome-popover-state",
          tabId: "browser-tab-1",
          popoverKind: "security",
          visible: false
        });
      }
    });

    fireEvent.click(screen.getByTitle("查看连接安全信息"));
    expect(setChromePopover).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-1",
        kind: "security",
        visible: true
      })
    );
  });

  test("keeps page-find input in the address bar while routing results to the native top layer", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => createRect(80, 24, 420, 30));
    const setChromePopover = vi.fn(async () => undefined);
    const onPageFindClose = vi.fn();
    const onPageFindNext = vi.fn();
    const onPageFindPrevious = vi.fn();

    renderNavigation({
      mode: "page-find",
      value: "Lyra",
      placeholder: "Find in page",
      activeBrowserTabId: "browser-tab-1",
      pageFindResult: {
        tabId: "browser-tab-1",
        address: "https://example.com/",
        title: "Example",
        query: "Lyra",
        currentIndex: 1,
        activeMatchId: "match-1",
        totalMatches: 2,
        matches: [
          {
            id: "match-1",
            index: 1,
            startChar: 4,
            endChar: 8,
            snippet: "Use Lyra browser search"
          }
        ],
        truncated: false
      },
      browserChromePopoverBridge: {
        setChromePopover
      },
      onPageFindClose,
      onPageFindNext,
      onPageFindPrevious
    });

    const shell = screen.getByLabelText("Address").closest(".lyra-titlebar-navigation-shell");
    expect(shell).not.toBeNull();
    expect(shell).toHaveAttribute("data-mode", "page-find");
    expect(shell).toHaveAttribute("data-native-find-open", "false");
    expect(shell).toHaveAttribute("data-suggestions-open", "false");
    expect(screen.getByLabelText("Address")).not.toHaveAttribute("readonly");
    expect(screen.queryByRole("listbox", { name: "网页内容搜索结果" })).toBeNull();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    await waitFor(() => {
      expect(setChromePopover).toHaveBeenCalledWith(
        expect.objectContaining({
          tabId: "browser-tab-1",
          kind: "find",
          visible: true,
          find: expect.objectContaining({
            query: "Lyra",
            currentIndex: 1,
            totalMatches: 2,
            matches: expect.arrayContaining([
              expect.objectContaining({ id: "match-1" })
            ])
          })
        })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /Next page result|下一页结果/u }));
    fireEvent.click(screen.getByRole("button", { name: /Previous page result|上一页结果/u }));
    expect(onPageFindNext).toHaveBeenCalledTimes(1);
    expect(onPageFindPrevious).toHaveBeenCalledTimes(1);
    expect(onPageFindClose).not.toHaveBeenCalled();
  });

  test("renders page-find results inside the shell when native popover is unavailable", () => {
    const onPageFindMatchClick = vi.fn();

    renderNavigation({
      mode: "page-find",
      value: "Lyra",
      placeholder: "Find in page",
      pageFindResult: {
        tabId: "browser-tab-1",
        address: "https://example.com/",
        title: "Example",
        query: "Lyra",
        currentIndex: 1,
        activeMatchId: "match-1",
        totalMatches: 2,
        matches: [
          {
            id: "match-1",
            index: 1,
            startChar: 4,
            endChar: 8,
            snippet: "Use Lyra browser search"
          }
        ],
        truncated: false
      },
      onPageFindMatchClick
    });

    const listbox = screen.getByRole("listbox", { name: "网页内容搜索结果" });
    const shell = listbox.closest(".lyra-titlebar-navigation-shell");
    expect(listbox.closest("form")).not.toBeNull();
    expect(shell).not.toBeNull();
    expect(shell).toHaveAttribute("data-suggestions-open", "true");
    expect(shell).toHaveAttribute("data-mode", "page-find");
    expect(shell).toHaveAttribute("data-native-find-open", "false");
    expect(screen.getByRole("option", { name: /Use Lyra browser search/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByText("1 / 2")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("option", { name: /Use Lyra browser search/ }));
    expect(onPageFindMatchClick).toHaveBeenCalledWith(1);
  });

  test("routes browser omnibox suggestions through the native browser popover layer", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => createRect(80, 24, 220, 30));
    const listeners = new Set<(event: any) => void>();
    const setChromePopover = vi.fn(async () => undefined);
    const onSuggestionClick = vi.fn();

    renderNavigation({
      value: "goo",
      activeBrowserTabId: "browser-tab-1",
      showSuggestions: true,
      selectedIndex: 1,
      suggestions: [
        { type: "history", value: "https://accounts.google.com/", label: "Google" },
        { type: "search", value: "google search", label: "Google" }
      ],
      onSuggestionClick,
      browserChromePopoverBridge: {
        setChromePopover,
        onEvent: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      }
    });

    expect(screen.queryByRole("listbox", { name: "地址建议" })).toBeNull();
    await waitFor(() => {
      expect(setChromePopover).toHaveBeenCalledWith(
        expect.objectContaining({
          tabId: "browser-tab-1",
          kind: "omnibox",
          visible: true,
          omnibox: expect.objectContaining({
            value: "goo",
            selectedIndex: 1,
            suggestions: expect.arrayContaining([
              expect.objectContaining({ value: "google search", type: "search" })
            ])
          })
        })
      );
    });

    act(() => {
      for (const listener of listeners) {
        listener({
          kind: "request-omnibox-suggestion-select",
          tabId: "browser-tab-1",
          index: 1
        });
      }
    });

    expect(onSuggestionClick).toHaveBeenCalledWith(
      expect.objectContaining({ value: "google search" })
    );
  });
});
