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
        dataset: { lyraTabWidth: String(width) }
      })
    }
  }) as unknown as ReactMouseEvent<HTMLElement>;

const flushQueuedCloses = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
};

describe("chrome tab strip close-lock", () => {
  test("freezes the closed tab width until cleared", async () => {
    const onCloseTab = vi.fn();
    const { result } = renderHook(() =>
      useChromeTabStripCloseLock({ tabCount: 3, onCloseTab })
    );

    act(() => {
      result.current.onCloseTab("docs", closeEvent(88.4));
    });
    expect(onCloseTab).not.toHaveBeenCalled();
    await flushQueuedCloses();

    expect(onCloseTab).toHaveBeenCalledWith("docs");
    expect(result.current.closeLockedTabWidth).toBe(88);

    act(() => {
      result.current.onClearCloseLock();
    });
    expect(result.current.closeLockedTabWidth).toBeNull();
  });

  test("does not lock the last remaining tab", async () => {
    const onCloseTab = vi.fn();
    const { result } = renderHook(() =>
      useChromeTabStripCloseLock({ tabCount: 1, onCloseTab })
    );

    act(() => {
      result.current.onCloseTab("home", closeEvent(88));
    });
    await flushQueuedCloses();

    expect(onCloseTab).toHaveBeenCalledWith("home");
    expect(result.current.closeLockedTabWidth).toBeNull();
  });

  test("commits a rapid close burst once", async () => {
    const onCloseTab = vi.fn();
    const { result } = renderHook(() =>
      useChromeTabStripCloseLock({ tabCount: 4, onCloseTab })
    );

    act(() => {
      result.current.onCloseTab("a", closeEvent(90));
      result.current.onCloseTab("b", closeEvent(90));
      result.current.onCloseTab("a", closeEvent(90));
    });
    expect(onCloseTab).not.toHaveBeenCalled();
    await flushQueuedCloses();

    expect(onCloseTab.mock.calls.map((call) => call[0])).toEqual(["a", "b"]);
    expect(result.current.closeLockedTabWidth).toBe(90);
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
