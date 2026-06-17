import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useRef } from "react";

import { useMessageHeightTable } from "../use-message-height-table";

describe("useMessageHeightTable scroll compensation", () => {
  let resizeObserverCallback: ResizeObserverCallback | null = null;

  beforeEach(() => {
    resizeObserverCallback = null;
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverCallback = callback;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("compensates scrollTop when an above-viewport slot grows", () => {
    const scrollEl = document.createElement("div");
    Object.defineProperty(scrollEl, "clientHeight", { value: 300 });
    scrollEl.scrollTop = 500;
    document.body.append(scrollEl);

    const scrollRef = { current: scrollEl };
    const orderedIdsRef = { current: ["a", "b", "c"] };

    const { result } = renderHook(() =>
      useMessageHeightTable(scrollRef, 80, orderedIdsRef, 24)
    );
    result.current.store.setMeasured("a", 100);

    const slotA = document.createElement("div");
    Object.defineProperty(slotA, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ height: 100 })
    });
    result.current.measureRef("a")(slotA);
    resizeObserverCallback?.(
      [{ target: slotA } as unknown as ResizeObserverEntry],
      {} as ResizeObserver
    );

    Object.defineProperty(slotA, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ height: 160 })
    });
    resizeObserverCallback?.(
      [{ target: slotA } as unknown as unknown as ResizeObserverEntry],
      {} as ResizeObserver
    );

    expect(scrollEl.scrollTop).toBe(560);
    scrollEl.remove();
  });
});
