import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import { resetWorkbenchStateStorageForTests } from "../../state-storage";
import { useLyraThreadRuntime } from "../use-lyra-thread-runtime";

describe("useLyraThreadRuntime shell", () => {
  beforeEach(() => {
    resetWorkbenchStateStorageForTests();
  });

  test("opens draft thread tabs immediately after the active tab", () => {
    const { result } = renderHook(() =>
      useLyraThreadRuntime({
        desktopApi: null,
      })
    );

    const firstTabId = result.current.state.activeTabId;
    act(() => {
      result.current.actions.selectThread(null);
    });
    const secondTabId = result.current.state.activeTabId;
    act(() => {
      result.current.actions.selectThread(null);
    });
    const thirdTabId = result.current.state.activeTabId;

    act(() => {
      result.current.actions.activateThreadTab(firstTabId!);
      result.current.actions.selectThread(null);
    });

    expect(result.current.state.threadTabs.map((tab) => tab.tabId)).toEqual([
      firstTabId,
      result.current.state.activeTabId,
      secondTabId,
      thirdTabId,
    ]);
  });

  test("closes active thread tabs toward the right", () => {
    const { result } = renderHook(() =>
      useLyraThreadRuntime({
        desktopApi: null,
      })
    );

    const firstTabId = result.current.state.activeTabId;
    act(() => {
      result.current.actions.selectThread(null);
    });
    const secondTabId = result.current.state.activeTabId;
    act(() => {
      result.current.actions.selectThread(null);
    });
    const thirdTabId = result.current.state.activeTabId;

    act(() => {
      result.current.actions.activateThreadTab(secondTabId!);
      result.current.actions.closeThreadTab(secondTabId!);
    });

    expect(result.current.state.activeTabId).toBe(thirdTabId);

    act(() => {
      result.current.actions.closeThreadTab(thirdTabId!);
    });

    expect(result.current.state.activeTabId).toBe(firstTabId);
  });

  test("runtime actions are disabled no-ops", async () => {
    const { result } = renderHook(() =>
      useLyraThreadRuntime({
        desktopApi: null,
      })
    );

    await act(async () => {
      await result.current.actions.sendTurn({ text: "Hello", attachments: [] });
      await result.current.actions.interruptTurn();
    });

    expect(result.current.state.activeThread).toBeNull();
    expect(result.current.state.threads).toEqual([]);
    expect(result.current.state.runtimeError).toBeNull();
    expect(result.current.state.isSending).toBe(false);
  });
});
