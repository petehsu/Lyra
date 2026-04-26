import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { resetWorkbenchStateStorageForTests } from "../../state-storage";
import { usePanelLayoutModel } from "../use-panel-layout";

describe("usePanelLayoutModel", () => {
  beforeEach(() => {
    resetWorkbenchStateStorageForTests();
  });

  test("grows the top terminal panel when dragging the horizontal divider down", () => {
    const { result } = renderHook(() => usePanelLayoutModel());
    const initialHeight = result.current.bottomHeight;

    act(() => {
      result.current.onBottomResizeMouseDown({
        clientY: 200,
        preventDefault: vi.fn()
      } as unknown as ReactMouseEvent<HTMLDivElement>);
    });

    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientY: 240 }));
    });

    expect(result.current.bottomHeight).toBeGreaterThan(initialHeight);

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
  });

  test("grows the bottom terminal panel when dragging the horizontal divider up", () => {
    const { result } = renderHook(() => usePanelLayoutModel());

    act(() => {
      result.current.toggleTerminalPanelSide();
    });

    expect(result.current.terminalPanelSide).toBe("bottom");
    const initialHeight = result.current.bottomHeight;

    act(() => {
      result.current.onBottomResizeMouseDown({
        clientY: 240,
        preventDefault: vi.fn()
      } as unknown as ReactMouseEvent<HTMLDivElement>);
    });

    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientY: 200 }));
    });

    expect(result.current.bottomHeight).toBeGreaterThan(initialHeight);

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
  });
});
