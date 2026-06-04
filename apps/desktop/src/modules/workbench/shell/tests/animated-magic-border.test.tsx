import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { AnimatedMagicBorder } from "../animated-magic-border";

const createMediaQueryList = (matches: boolean, media: string): MediaQueryList => ({
  matches,
  media,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn()
});

describe("AnimatedMagicBorder", () => {
  const originalMatchMedia = window.matchMedia;
  let frameCallbacks: Map<number, FrameRequestCallback>;
  let nextFrameHandle: number;

  const runNextFrame = (nowMs: number): void => {
    const entry = frameCallbacks.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    expect(entry).not.toBeUndefined();
    if (entry === undefined) {
      return;
    }
    const [handle, callback] = entry;
    frameCallbacks.delete(handle);
    act(() => {
      callback(nowMs);
    });
  };

  beforeEach(() => {
    frameCallbacks = new Map();
    nextFrameHandle = 1;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => createMediaQueryList(false, query))
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const handle = nextFrameHandle;
      nextFrameHandle += 1;
      frameCallbacks.set(handle, callback);
      return handle;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) => {
      frameCallbacks.delete(handle);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    frameCallbacks.clear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia
    });
  });

  test("does not request ambient frames while closed", () => {
    const { container, rerender } = render(<AnimatedMagicBorder isOpen={false} />);
    const sweep = container.querySelector(".lyra-magic-border-sweep") as HTMLDivElement;

    expect(sweep.style.webkitMaskImage).toContain("96deg");
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    const closedMask = sweep.style.webkitMaskImage;

    rerender(<AnimatedMagicBorder isOpen />);
    runNextFrame(100);

    expect(sweep.style.webkitMaskImage).toContain("conic-gradient");
    expect(sweep.style.webkitMaskImage).not.toBe("none");
    expect(sweep.style.webkitMaskImage).not.toBe(closedMask);
  });

  test("unwraps from the open ring instead of snapping back to the short sweep", () => {
    const { container, rerender } = render(<AnimatedMagicBorder isOpen />);
    const sweep = container.querySelector(".lyra-magic-border-sweep") as HTMLDivElement;

    expect(sweep.style.webkitMaskImage).toBe("none");
    runNextFrame(0);

    rerender(<AnimatedMagicBorder isOpen={false} />);
    runNextFrame(100);

    expect(sweep.style.webkitMaskImage).toContain("conic-gradient");
    expect(sweep.style.webkitMaskImage).not.toBe("none");
    expect(sweep.style.webkitMaskImage).not.toContain("black 72deg, black 96deg");
  });

  test("stops requesting frames once the close transition settles", () => {
    const { rerender } = render(<AnimatedMagicBorder isOpen />);

    runNextFrame(0);
    rerender(<AnimatedMagicBorder isOpen={false} />);

    for (let index = 0; index < 80 && frameCallbacks.size > 0; index += 1) {
      runNextFrame(100 + index * 50);
    }

    expect(frameCallbacks.size).toBe(0);
  });
});
