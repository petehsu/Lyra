import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { readWorkbenchStateSync, resetWorkbenchStateStorageForTests } from "../../state-storage";
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
      window.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(result.current.bottomHeight).toBeGreaterThan(initialHeight);
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
      window.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(result.current.bottomHeight).toBeGreaterThan(initialHeight);
  });

  test("toggles the panel-resizing body class across a divider drag", () => {
    const { result } = renderHook(() => usePanelLayoutModel());

    act(() => {
      result.current.onLeftResizeMouseDown({
        clientX: 100,
        preventDefault: vi.fn()
      } as unknown as ReactMouseEvent<HTMLDivElement>);
    });
    expect(document.body.classList.contains("lyra-panel-resizing")).toBe(true);

    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 180 }));
      window.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(document.body.classList.contains("lyra-panel-resizing")).toBe(false);
  });

  test("persists panel sizes when a drag ends", () => {
    const { result } = renderHook(() => usePanelLayoutModel());

    act(() => {
      result.current.onLeftResizeMouseDown({
        clientX: 100,
        preventDefault: vi.fn()
      } as unknown as ReactMouseEvent<HTMLDivElement>);
    });

    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 180 }));
      window.dispatchEvent(new MouseEvent("mouseup"));
    });

    const persisted = JSON.parse(readWorkbenchStateSync("layout") ?? "{}") as {
      readonly leftWidth?: number;
      readonly bottomHeight?: number;
    };
    expect(persisted.leftWidth).toBe(result.current.leftWidth);
    expect(persisted.bottomHeight).toBe(result.current.bottomHeight);
  });

  test("persists shared app sidebar width from sidebar edge drag", () => {
    const root = document.createElement("div");
    const sidebar = document.createElement("aside");
    sidebar.className = "lyra-app-sidebar-nav";
    Object.defineProperty(sidebar, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        top: 0,
        right: 220,
        bottom: 400,
        width: 220,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => ({})
      })
    });
    root.append(sidebar);
    document.body.append(root);
    const ref = { current: root };
    const { result } = renderHook(() => usePanelLayoutModel(ref));

    act(() => {
      sidebar.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        clientX: 220
      }));
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 260 }));
      window.dispatchEvent(new MouseEvent("mouseup"));
    });

    const persisted = JSON.parse(readWorkbenchStateSync("layout") ?? "{}") as {
      readonly appSidebarWidth?: number;
    };
    expect(result.current.appSidebarWidth).toBe(260);
    expect(persisted.appSidebarWidth).toBe(260);
    root.remove();
  });

  test.each(["blur", "Escape", "unmount"])("cleans up an interrupted drag on %s", (reason) => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const { result, unmount } = renderHook(() => usePanelLayoutModel());
    const cursor = document.body.style.cursor;
    const selection = document.body.style.userSelect;
    act(() => result.current.onLeftResizeMouseDown({
      clientX: 100, button: 0, preventDefault: vi.fn()
    } as unknown as ReactMouseEvent<HTMLDivElement>));
    expect(frame).toHaveClass("lyra-pointer-events-disabled");
    expect(document.body).not.toHaveClass("lyra-layout-resizing");
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 150 }));
      if (reason === "unmount") unmount();
      else window.dispatchEvent(reason === "Escape"
        ? new KeyboardEvent("keydown", { key: "Escape" }) : new Event("blur"));
    });
    expect(document.body).not.toHaveClass("lyra-layout-resizing");
    expect(document.body.style.cursor).toBe(cursor);
    expect(document.body.style.userSelect).toBe(selection);
    expect(frame).not.toHaveClass("lyra-pointer-events-disabled");
    const saved = readWorkbenchStateSync("layout");
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 350 }));
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(readWorkbenchStateSync("layout")).toBe(saved);
    frame.remove();
  });

  test("ignores secondary-button drags", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const { result } = renderHook(() => usePanelLayoutModel());
    const width = result.current.leftWidth;
    act(() => result.current.onLeftResizeMouseDown({
      clientX: 100, button: 2, preventDefault: vi.fn()
    } as unknown as ReactMouseEvent<HTMLDivElement>));
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 400 }));
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(result.current.leftWidth).toBe(width);
    expect(frame).not.toHaveClass("lyra-pointer-events-disabled");
    expect(document.body).not.toHaveClass("lyra-layout-resizing");
    frame.remove();
  });
});
