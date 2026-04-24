import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useTypewriter } from "../use-typewriter";

describe("useTypewriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("clears previous buffered text when a new streaming turn starts", () => {
    const { result, rerender } = renderHook(
      ({
        sourceText,
        isActive,
        resetKey,
      }: {
        readonly sourceText: string;
        readonly isActive: boolean;
        readonly resetKey: string | null;
      }) =>
        useTypewriter(sourceText, isActive, {
          charsPerSecond: 120,
          minChunkSize: 2,
          resetKey,
        }),
      {
        initialProps: {
          sourceText: "Previous answer",
          isActive: true,
          resetKey: "turn-1",
        },
      }
    );

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(result.current.length).toBeGreaterThan(0);

    rerender({
      sourceText: "",
      isActive: true,
      resetKey: "turn-2",
    });

    expect(result.current).toBe("");
  });
});
