import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { AgentBrowserPreviewSnapshot } from "../../../../../shared/agent";
import type { LyraDesktopApi } from "../../../../../shared/desktop-bridge";
import { useAgentBrowserPreview, openAgentBrowserPreviewTarget } from "./useAgentBrowserPreview";
import {
  registerAgentBrowserPreviewWorkspace,
  resetAgentBrowserPreviewWorkspaceForTests
} from "./agent-browser-preview-workspace";

const snapshot: AgentBrowserPreviewSnapshot = {
  tabId: "tab-live",
  targetMode: "live",
  url: "https://example.com",
  title: "Example",
  mimeType: "image/png",
  imageBase64: "AAAA",
  width: 80,
  height: 50
};

afterEach(() => {
  vi.useRealTimers();
  resetAgentBrowserPreviewWorkspaceForTests();
});

describe("useAgentBrowserPreview", () => {
  test("polls while the turn is running and keeps the front item when it stops", async () => {
    const readAgentBrowserPreview = vi.fn(async () => [snapshot]);
    const desktopApi = {
      agent: { readAgentBrowserPreview }
    } as unknown as LyraDesktopApi;

    const { rerender, result } = renderHook(
      ({ isTurnRunning }) => useAgentBrowserPreview({ desktopApi, isTurnRunning }),
      { initialProps: { isTurnRunning: true } }
    );

    await waitFor(() => {
      expect(result.current.items).toEqual([snapshot]);
    });
    expect(readAgentBrowserPreview).toHaveBeenCalled();

    rerender({ isTurnRunning: false });
    await waitFor(() => {
      expect(result.current.items).toEqual([snapshot]);
    });
  });

  test("does not poll when the turn is idle", () => {
    const readAgentBrowserPreview = vi.fn(async () => [snapshot]);
    const desktopApi = {
      agent: { readAgentBrowserPreview }
    } as unknown as LyraDesktopApi;

    const { result } = renderHook(() =>
      useAgentBrowserPreview({ desktopApi, isTurnRunning: false })
    );

    expect(result.current.items).toEqual([]);
    expect(readAgentBrowserPreview).not.toHaveBeenCalled();
  });

  test("refreshes on the 500ms interval", async () => {
    vi.useFakeTimers();
    const readAgentBrowserPreview = vi.fn(async () => [snapshot]);
    const desktopApi = {
      agent: { readAgentBrowserPreview }
    } as unknown as LyraDesktopApi;

    renderHook(() => useAgentBrowserPreview({ desktopApi, isTurnRunning: true }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(readAgentBrowserPreview).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(readAgentBrowserPreview).toHaveBeenCalledTimes(2);
  });

  test("keeps only the front item as a capsule after the turn ends", async () => {
    const second: AgentBrowserPreviewSnapshot = {
      ...snapshot,
      tabId: "tab-back",
      title: "Back"
    };
    const readAgentBrowserPreview = vi.fn(async () => [snapshot, second]);
    const desktopApi = {
      agent: { readAgentBrowserPreview }
    } as unknown as LyraDesktopApi;

    const { rerender, result } = renderHook(
      ({ isTurnRunning }) => useAgentBrowserPreview({ desktopApi, isTurnRunning }),
      { initialProps: { isTurnRunning: true } }
    );

    await waitFor(() => {
      expect(result.current.items).toEqual([snapshot, second]);
    });

    rerender({ isTurnRunning: false });
    expect(result.current.items).toEqual([snapshot]);
  });

  test("opens live preview on the existing workspace tab", () => {
    const setActiveBrowserTab = vi.fn(() => true);
    const openUrlInWorkbench = vi.fn();
    openAgentBrowserPreviewTarget(snapshot, { setActiveBrowserTab, openUrlInWorkbench });
    expect(setActiveBrowserTab).toHaveBeenCalledWith("tab-live");
    expect(openUrlInWorkbench).not.toHaveBeenCalled();
  });

  test("promotes a missing live preview onto the same tab id instead of cloning the URL", () => {
    const setActiveBrowserTab = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const openUrlInWorkbench = vi.fn();
    const parked: { tabId: string; address: string; titleHint?: string }[] = [];
    registerAgentBrowserPreviewWorkspace({
      parkTabIfWatched: () => false,
      ensureParked: (page) => {
        parked.push({
          tabId: page.tabId,
          address: page.address,
          ...(page.titleHint === undefined ? {} : { titleHint: page.titleHint })
        });
      },
      promoteOrActivate: (tabId) => parked.some((page) => page.tabId === tabId),
      destroyWatch: () => undefined
    });
    openAgentBrowserPreviewTarget(snapshot, { setActiveBrowserTab, openUrlInWorkbench });
    expect(setActiveBrowserTab).toHaveBeenNthCalledWith(1, "tab-live");
    expect(setActiveBrowserTab).toHaveBeenNthCalledWith(2, "tab-live");
    expect(parked).toEqual([
      {
        tabId: "tab-live",
        address: "https://example.com",
        titleHint: "Example"
      }
    ]);
    expect(openUrlInWorkbench).not.toHaveBeenCalled();
  });

  test("opens isolated preview as a workspace URL", () => {
    const setActiveBrowserTab = vi.fn(() => false);
    const openUrlInWorkbench = vi.fn();
    openAgentBrowserPreviewTarget(
      { ...snapshot, tabId: "tab-iso", targetMode: "isolated", title: "App" },
      { setActiveBrowserTab, openUrlInWorkbench }
    );
    expect(setActiveBrowserTab).not.toHaveBeenCalled();
    expect(openUrlInWorkbench).toHaveBeenCalledWith("https://example.com", "App");
  });

  test("does not open an isolated preview without a URL", () => {
    const setActiveBrowserTab = vi.fn(() => false);
    const openUrlInWorkbench = vi.fn();
    openAgentBrowserPreviewTarget(
      { ...snapshot, targetMode: "isolated", url: "", title: "" },
      { setActiveBrowserTab, openUrlInWorkbench }
    );
    expect(setActiveBrowserTab).not.toHaveBeenCalled();
    expect(openUrlInWorkbench).not.toHaveBeenCalled();
  });
});
