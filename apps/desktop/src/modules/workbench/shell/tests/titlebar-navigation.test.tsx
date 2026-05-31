import { act, fireEvent, render, screen } from "@testing-library/react";
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
    vi.restoreAllMocks();
  });

  test("uses the submit label for the default primary action", () => {
    const { onSubmit } = renderNavigation();

    const button = screen.getByRole("button", { name: "Go" });
    expect(button).toHaveAttribute("title", "Go");

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

    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
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
    fireEvent.click(screen.getByTitle("点击查看连接安全与证书信息"));

    const popover = screen.getByRole("dialog", { name: "连接安全与证书信息" });
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
    fireEvent.click(screen.getByTitle("点击查看连接安全与证书信息"));

    expect(screen.queryByRole("dialog", { name: "连接安全与证书信息" })).toBeNull();
    expect(setChromePopover).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-1",
        kind: "security",
        visible: true,
        security: expect.objectContaining({
          level: "secure",
          domain: "example.com"
        })
      })
    );

    fireEvent.click(screen.getByTitle("点击查看连接安全与证书信息"));
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
    fireEvent.click(screen.getByTitle("点击查看连接安全与证书信息"));
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

    fireEvent.click(screen.getByTitle("点击查看连接安全与证书信息"));
    expect(setChromePopover).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-1",
        kind: "security",
        visible: true
      })
    );
  });
});
