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

  test("renders omnibox suggestions as an overlay matching the input width", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getMockRect(this: HTMLElement) {
        if (this.classList.contains("lyra-titlebar-navigation-form")) {
          return createRect(80, 24, 420, 30);
        }
        if (this.getAttribute("role") === "listbox") {
          return createRect(80, 0, 420, 120);
        }
        return createRect(80, 24, 420, 30);
      });
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

    const listbox = screen.getByRole("listbox", { name: "Address suggestions" });
    const shell = screen.getByLabelText("Address").closest(".lyra-titlebar-navigation-shell");

    expect(listbox.closest("form")).toBeNull();
    expect(listbox.closest(".lyra-titlebar-navigation-shell")).toBeNull();
    expect(shell).not.toBeNull();
    expect(shell).not.toHaveAttribute("data-suggestions-open");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    await waitFor(() => {
      expect(listbox.style.width).toBe("420px");
    });

    fireEvent.mouseDown(screen.getByText("github actions (Wikipedia)"));
    expect(onSuggestionClick).toHaveBeenCalledWith(
      expect.objectContaining({ value: "github actions" })
    );
  });

  test("does not render a connection-security icon in the address field", () => {
    const setChromePopover = vi.fn(async () => undefined);
    renderNavigation({
      activeBrowserTabId: "browser-tab-1",
      browserChromePopoverBridge: { setChromePopover }
    });

    expect(screen.queryByTitle("Connection is secure")).toBeNull();
    expect(screen.queryByLabelText("Connection is secure")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".lyra-titlebar-navigation-security")).toBeNull();
    expect(setChromePopover).not.toHaveBeenCalled();
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
    expect(screen.getByLabelText("Address")).not.toHaveAttribute("readonly");
    expect(screen.queryByRole("listbox", { name: "Page content search results" })).toBeNull();
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

  test("renders page-find results as an overlay when native popover is unavailable", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getMockRect(this: HTMLElement) {
        if (this.classList.contains("lyra-titlebar-navigation-form")) {
          return createRect(80, 24, 420, 30);
        }
        if (this.getAttribute("role") === "listbox") {
          return createRect(80, 0, 420, 96);
        }
        return createRect(80, 24, 420, 30);
      });
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

    const listbox = screen.getByRole("listbox", { name: "Page content search results" });
    const shell = screen.getByLabelText("Address").closest(".lyra-titlebar-navigation-shell");
    expect(listbox.closest("form")).toBeNull();
    expect(listbox.closest(".lyra-titlebar-navigation-shell")).toBeNull();
    expect(shell).not.toBeNull();
    expect(shell).not.toHaveAttribute("data-suggestions-open");
    expect(shell).toHaveAttribute("data-mode", "page-find");
    await waitFor(() => {
      expect(listbox.style.width).toBe("420px");
    });
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

    expect(screen.queryByRole("listbox", { name: "Address suggestions" })).toBeNull();
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
