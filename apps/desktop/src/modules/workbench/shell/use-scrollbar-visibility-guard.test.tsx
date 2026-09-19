import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, test, vi } from "vitest";

import { useScrollbarVisibilityGuard } from "./use-scrollbar-visibility-guard";

function Harness() {
  const rootRef = useRef<HTMLDivElement>(null);
  useScrollbarVisibilityGuard(rootRef);
  return (
    <div ref={rootRef}>
      <div data-testid="first" style={{ overflowY: "auto" }} />
    </div>
  );
}

describe("useScrollbarVisibilityGuard", () => {
  test("does not walk chrome overflow or attach mutation observers", () => {
    const mutationObserve = vi.fn();
    vi.stubGlobal("MutationObserver", class {
      observe = mutationObserve;
      disconnect(): void {}
      takeRecords(): MutationRecord[] {
        return [];
      }
    });

    render(<Harness />);

    expect(mutationObserve).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
