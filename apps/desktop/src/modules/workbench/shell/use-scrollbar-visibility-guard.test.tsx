import { render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useScrollbarVisibilityGuard } from "./use-scrollbar-visibility-guard";

let resizeCallback: ResizeObserverCallback | null = null;

function Harness() {
  const rootRef = useRef<HTMLDivElement>(null);
  useScrollbarVisibilityGuard(rootRef);
  return (
    <div ref={rootRef}>
      <div data-testid="first" style={{ overflowY: "auto" }} />
      <div data-testid="second" style={{ overflowY: "auto" }} />
    </div>
  );
}

describe("useScrollbarVisibilityGuard", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
    vi.stubGlobal("MutationObserver", class {
      observe(): void {}
      disconnect(): void {}
      takeRecords(): MutationRecord[] {
        return [];
      }
    });
  });

  afterEach(() => {
    resizeCallback = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("rechecks only elements reported by ResizeObserver", async () => {
    const { getByTestId } = render(<Harness />);
    const first = getByTestId("first");
    const second = getByTestId("second");
    const firstScrollHeight = vi.spyOn(first, "scrollHeight", "get").mockReturnValue(100);
    const secondScrollHeight = vi.spyOn(second, "scrollHeight", "get").mockReturnValue(100);

    firstScrollHeight.mockClear();
    secondScrollHeight.mockClear();
    resizeCallback?.(
      [{ target: first } as unknown as ResizeObserverEntry],
      {} as ResizeObserver
    );

    await waitFor(() => expect(firstScrollHeight).toHaveBeenCalled());
    expect(secondScrollHeight).not.toHaveBeenCalled();
  });
});
