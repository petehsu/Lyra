import { createRef } from "react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useAsciiFlicker } from "../use-ascii-flicker";

const SOURCE = ["##  ##", "  ::  ", "==--=="].join("\n");

const setReducedMotion = (matches: boolean): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  })) as unknown as typeof window.matchMedia;
};

function Harness({ source }: { source: string }) {
  const ref = createRef<HTMLPreElement>();
  useAsciiFlicker(ref, source);
  return <pre ref={ref} data-testid="logo" />;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useAsciiFlicker", () => {
  test("renders the static art and never mutates spaces or newlines", () => {
    setReducedMotion(false);
    vi.useFakeTimers();
    const { getByTestId } = render(<Harness source={SOURCE} />);
    const pre = getByTestId("logo");

    expect(pre.textContent).toBe(SOURCE);

    // Advance several throttled ticks.
    for (let i = 0; i < 20; i += 1) vi.advanceTimersByTime(96);

    const frame = pre.textContent ?? "";
    // Structure is preserved: same length, spaces/newlines stay put.
    expect(frame).toHaveLength(SOURCE.length);
    for (let i = 0; i < SOURCE.length; i += 1) {
      const original = SOURCE[i]!;
      if (original === " " || original === "\n") {
        expect(frame[i]).toBe(original);
      }
    }
  });

  test("leaves the art static when reduced motion is preferred", () => {
    setReducedMotion(true);
    vi.useFakeTimers();
    const { getByTestId } = render(<Harness source={SOURCE} />);
    const pre = getByTestId("logo");

    for (let i = 0; i < 20; i += 1) vi.advanceTimersByTime(96);

    expect(pre.textContent).toBe(SOURCE);
  });

  test("restores the original art on unmount", () => {
    setReducedMotion(false);
    vi.useFakeTimers();
    const { getByTestId, unmount } = render(<Harness source={SOURCE} />);
    const pre = getByTestId("logo");
    for (let i = 0; i < 5; i += 1) vi.advanceTimersByTime(96);
    unmount();
    expect(pre.textContent).toBe(SOURCE);
  });
});
