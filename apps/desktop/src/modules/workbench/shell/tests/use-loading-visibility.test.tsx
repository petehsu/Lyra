import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useLoadingVisibility } from "../use-loading-visibility";

describe("useLoadingVisibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("delays skeleton visibility before showing", () => {
    const { result } = renderHook(() =>
      useLoadingVisibility(true, { showDelayMs: 120, minVisibleMs: 180 })
    );

    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(119);
    });
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
  });

  test("does not show when loading completes before delay", () => {
    const { result, rerender } = renderHook(
      ({ loading }) =>
        useLoadingVisibility(loading, { showDelayMs: 120, minVisibleMs: 180 }),
      {
        initialProps: { loading: true }
      }
    );

    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(result.current).toBe(false);

    rerender({ loading: false });

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current).toBe(false);
  });

  test("keeps skeleton visible for minimum duration once shown", () => {
    const { result, rerender } = renderHook(
      ({ loading }) =>
        useLoadingVisibility(loading, { showDelayMs: 120, minVisibleMs: 180 }),
      {
        initialProps: { loading: true }
      }
    );

    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(result.current).toBe(true);

    rerender({ loading: false });

    act(() => {
      vi.advanceTimersByTime(179);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });

  test("keeps visible when loading resumes during pending hide", () => {
    const { result, rerender } = renderHook(
      ({ loading }) =>
        useLoadingVisibility(loading, { showDelayMs: 120, minVisibleMs: 180 }),
      {
        initialProps: { loading: true }
      }
    );

    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(result.current).toBe(true);

    rerender({ loading: false });

    act(() => {
      vi.advanceTimersByTime(90);
    });
    expect(result.current).toBe(true);

    rerender({ loading: true });

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(true);
  });
});
