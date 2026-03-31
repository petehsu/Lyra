import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { useContextMenuModel } from "../service";

describe("context menu model", () => {
  test("opens and closes menu", () => {
    const { result } = renderHook(() => useContextMenuModel());

    act(() => {
      result.current.openMenu({
        anchorX: 120,
        anchorY: 88,
        items: []
      });
    });

    expect(result.current.state.isOpen).toBe(true);
    expect(result.current.state.anchorX).toBe(120);
    expect(result.current.state.anchorY).toBe(88);

    act(() => {
      result.current.closeMenu();
    });

    expect(result.current.state.isOpen).toBe(false);
  });

  test("selectItem executes callback and closes menu", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useContextMenuModel());

    act(() => {
      result.current.openMenu({
        anchorX: 10,
        anchorY: 10,
        items: [
          {
            id: "open",
            label: "Open",
            onSelect
          }
        ]
      });
    });

    act(() => {
      result.current.selectItem("open");
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(result.current.state.isOpen).toBe(false);
  });
});
