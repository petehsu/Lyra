import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useAutoScroll } from "./use-auto-scroll";

const layoutScroller = (
  el: HTMLElement,
  options: { readonly clientHeight: number; readonly scrollHeight: number; readonly scrollTop: number }
): void => {
  Object.defineProperty(el, "clientHeight", { configurable: true, value: options.clientHeight });
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: options.scrollHeight });
  el.scrollTop = options.scrollTop;
};

describe("useAutoScroll", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("resume pins to bottom and later content growth keeps following", () => {
    const { result } = renderHook(() => useAutoScroll({
      working: true,
      overflowAnchor: "none",
      bottomThreshold: 8
    }));
    const scroller = document.createElement("div");
    layoutScroller(scroller, { clientHeight: 200, scrollHeight: 800, scrollTop: 200 });

    act(() => {
      result.current.setScrollElement(scroller);
      result.current.pause();
    });
    expect(result.current.userScrolled()).toBe(true);

    act(() => {
      result.current.resume();
    });
    expect(result.current.userScrolled()).toBe(false);
    expect(scroller.scrollTop).toBe(600);

    layoutScroller(scroller, { clientHeight: 200, scrollHeight: 1100, scrollTop: 600 });
    act(() => {
      result.current.follow();
    });
    expect(scroller.scrollTop).toBe(900);
  });

  test("wheel up unlocks follow so content growth no longer drags the viewport", () => {
    const { result } = renderHook(() => useAutoScroll({
      working: true,
      overflowAnchor: "none",
      bottomThreshold: 8
    }));
    const scroller = document.createElement("div");
    layoutScroller(scroller, { clientHeight: 200, scrollHeight: 800, scrollTop: 600 });
    act(() => {
      result.current.setScrollElement(scroller);
      result.current.resume();
    });

    act(() => {
      result.current.handleWheel({ deltaY: -40, target: scroller });
    });
    expect(result.current.userScrolled()).toBe(true);

    scroller.scrollTop = 120;
    layoutScroller(scroller, { clientHeight: 200, scrollHeight: 1100, scrollTop: 120 });
    act(() => {
      result.current.follow();
    });
    expect(scroller.scrollTop).toBe(120);
  });

  test("wheel down does not unlock follow", () => {
    const { result } = renderHook(() => useAutoScroll({
      working: true,
      overflowAnchor: "none"
    }));
    const scroller = document.createElement("div");
    layoutScroller(scroller, { clientHeight: 200, scrollHeight: 800, scrollTop: 600 });
    act(() => {
      result.current.setScrollElement(scroller);
      result.current.resume();
      result.current.handleWheel({ deltaY: 40, target: scroller });
    });
    expect(result.current.userScrolled()).toBe(false);
  });

  test("wheel up inside a nested data-scrollable region does not unlock", () => {
    const { result } = renderHook(() => useAutoScroll({
      working: true,
      overflowAnchor: "none"
    }));
    const scroller = document.createElement("div");
    const nested = document.createElement("div");
    nested.setAttribute("data-scrollable", "true");
    scroller.append(nested);
    layoutScroller(scroller, { clientHeight: 200, scrollHeight: 800, scrollTop: 600 });
    act(() => {
      result.current.setScrollElement(scroller);
      result.current.resume();
      result.current.handleWheel({ deltaY: -40, target: nested });
    });
    expect(result.current.userScrolled()).toBe(false);
  });

  test("scrolling back to the bottom re-locks follow", () => {
    const { result } = renderHook(() => useAutoScroll({
      working: true,
      overflowAnchor: "none",
      bottomThreshold: 8
    }));
    const scroller = document.createElement("div");
    layoutScroller(scroller, { clientHeight: 200, scrollHeight: 800, scrollTop: 600 });
    act(() => {
      result.current.setScrollElement(scroller);
      result.current.pause();
    });
    expect(result.current.userScrolled()).toBe(true);

    layoutScroller(scroller, { clientHeight: 200, scrollHeight: 800, scrollTop: 595 });
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.userScrolled()).toBe(false);
  });

  test("a stale empty-layout auto mark does not pin when the user is at the top", () => {
    const { result } = renderHook(() => useAutoScroll({
      working: true,
      overflowAnchor: "none",
      bottomThreshold: 8
    }));
    const scroller = document.createElement("div");
    layoutScroller(scroller, { clientHeight: 0, scrollHeight: 0, scrollTop: 0 });
    act(() => {
      result.current.setScrollElement(scroller);
      result.current.resume();
    });

    layoutScroller(scroller, { clientHeight: 300, scrollHeight: 600, scrollTop: 0 });
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.userScrolled()).toBe(true);
    expect(scroller.scrollTop).toBe(0);
  });
});
