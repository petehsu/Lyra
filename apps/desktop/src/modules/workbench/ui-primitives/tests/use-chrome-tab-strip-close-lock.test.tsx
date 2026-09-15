import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { MouseEvent as ReactMouseEvent } from "react";

import {
  handleChromeTabCloseClick,
  handleChromeTabClosePointerDown,
  useChromeTabStripCloseLock
} from "../use-chrome-tab-strip-close-lock";

const closeEvent = (width: number): ReactMouseEvent<HTMLElement> =>
  ({
    currentTarget: {
      closest: () => ({
        getBoundingClientRect: () => ({ width })
      })
    }
  }) as unknown as ReactMouseEvent<HTMLElement>;

describe("chrome tab strip close-lock", () => {
  test("freezes the closed tab width until cleared", () => {
    const onCloseTab = vi.fn();
    const { result } = renderHook(() =>
      useChromeTabStripCloseLock({ tabCount: 3, onCloseTab })
    );

    act(() => {
      result.current.onCloseTab("docs", closeEvent(88.4));
    });

    expect(onCloseTab).toHaveBeenCalledWith("docs");
    expect(result.current.closeLockedTabWidth).toBe(88);

    act(() => {
      result.current.onClearCloseLock();
    });
    expect(result.current.closeLockedTabWidth).toBeNull();
  });

  test("does not lock the last remaining tab", () => {
    const onCloseTab = vi.fn();
    const { result } = renderHook(() =>
      useChromeTabStripCloseLock({ tabCount: 1, onCloseTab })
    );

    act(() => {
      result.current.onCloseTab("home", closeEvent(88));
    });

    expect(onCloseTab).toHaveBeenCalledWith("home");
    expect(result.current.closeLockedTabWidth).toBeNull();
  });

  test("closes on primary pointerdown and ignores the follow-up mouse click", () => {
    const onClose = vi.fn();
    const currentTarget = document.createElement("button");
    const pointerDown = {
      button: 0,
      currentTarget,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    };
    handleChromeTabClosePointerDown(
      pointerDown as unknown as Parameters<typeof handleChromeTabClosePointerDown>[0],
      onClose
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(pointerDown.preventDefault).toHaveBeenCalled();

    handleChromeTabCloseClick(
      {
        detail: 1,
        currentTarget,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      } as unknown as Parameters<typeof handleChromeTabCloseClick>[0],
      onClose
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    handleChromeTabCloseClick(
      {
        detail: 0,
        currentTarget,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      } as unknown as Parameters<typeof handleChromeTabCloseClick>[0],
      onClose
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
