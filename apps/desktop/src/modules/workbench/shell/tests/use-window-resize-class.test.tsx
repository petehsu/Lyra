import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { subscribeLayoutResizeEnd } from "../layout-resize-end";
import { getIsWindowResizing, useWindowResizeClass } from "../use-window-resize-class";

afterEach(() => vi.useRealTimers());

test("defers expensive surfaces until native window resize settles and flushes final layout", () => {
  vi.useFakeTimers();
  const onEnd = vi.fn();
  const unsubscribe = subscribeLayoutResizeEnd(onEnd);
  const { unmount } = renderHook(useWindowResizeClass);
  act(() => {
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(100);
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(100);
  });
  expect(getIsWindowResizing()).toBe(true);
  expect(document.body).toHaveClass("lyra-window-resizing");
  expect(onEnd).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(50));
  expect(getIsWindowResizing()).toBe(false);
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(document.body).not.toHaveClass("lyra-window-resizing");
  act(() => window.dispatchEvent(new Event("resize")));
  unmount();
  expect(getIsWindowResizing()).toBe(false);
  expect(onEnd).toHaveBeenCalledTimes(2);
  act(() => vi.runAllTimers());
  expect(onEnd).toHaveBeenCalledTimes(2);
  unsubscribe();
});
