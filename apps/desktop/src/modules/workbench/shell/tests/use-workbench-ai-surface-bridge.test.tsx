import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { AiPanelWriteStreamEvent } from "../../ai-panel";
import type { FileEditorModel } from "../../file-editor";
import type { TerminalDockModel } from "../../terminal-dock/types";
import type { WorkbenchSidebarAiSurfaceProps } from "../use-workbench-ai-surface-bridge";
import { useWorkbenchAiSurfaceBridge } from "../use-workbench-ai-surface-bridge";

const createWriteEvent = (
  overrides: Partial<AiPanelWriteStreamEvent>
): AiPanelWriteStreamEvent => ({
  kind: "started",
  sessionId: "session-1",
  turnId: "turn-1",
  toolCallId: "tool-1",
  toolName: "write",
  filePath: "/tmp/app.ts",
  timestamp: 1000,
  ...overrides
} as AiPanelWriteStreamEvent);

describe("useWorkbenchAiSurfaceBridge", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("paces write stream deltas and records a completed review item", () => {
    vi.useFakeTimers();
    const fileEditorModel = {
      applyExternalContent: vi.fn(),
      revealLocation: vi.fn()
    } as unknown as FileEditorModel;
    const terminalModel = {} as unknown as TerminalDockModel;
    const onOpenFileFromManager = vi.fn(() => "editor-1");
    const recordCompletedEditorWorkItem = vi.fn();
    const sidebarAiSurfaceProps = {
      desktopApi: null,
      title: "AI"
    } as WorkbenchSidebarAiSurfaceProps;
    const { result } = renderHook(() =>
      useWorkbenchAiSurfaceBridge({
        desktopApi: null,
        sidebarAiSurfaceProps,
        fileEditorModel,
        terminalModel,
        onOpenFileFromManager,
        recordCompletedEditorWorkItem
      })
    );

    act(() => {
      result.current?.onWriteStreamEvent?.(createWriteEvent({
        kind: "started",
        baselineContent: "before\n"
      }));
      result.current?.onWriteStreamEvent?.(createWriteEvent({
        kind: "delta",
        chunkText: "after",
        firstChangedLine: 2,
        timestamp: 1010
      }));
      result.current?.onWriteStreamEvent?.(createWriteEvent({
        kind: "finished",
        status: "completed",
        timestamp: 1020
      }));
      vi.advanceTimersByTime(120);
    });

    expect(fileEditorModel.applyExternalContent).toHaveBeenLastCalledWith("editor-1", "before\nafter", {
      markHydrated: true
    });
    expect(onOpenFileFromManager).toHaveBeenCalledWith(
      "/tmp/app.ts",
      { line: 2 },
      { forceReloadIfOpen: true }
    );
    expect(recordCompletedEditorWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "editor-work-tool-1",
        status: "completed",
        filePath: "/tmp/app.ts",
        firstChangedLine: 2,
        baselineContent: "before\n"
      })
    );
  });

  test("reloads and records review items for final-only write events", () => {
    vi.useFakeTimers();
    const fileEditorModel = {
      applyExternalContent: vi.fn(),
      revealLocation: vi.fn()
    } as unknown as FileEditorModel;
    const terminalModel = {} as unknown as TerminalDockModel;
    const onOpenFileFromManager = vi.fn(() => "editor-1");
    const recordCompletedEditorWorkItem = vi.fn();
    const sidebarAiSurfaceProps = {
      desktopApi: null,
      title: "AI"
    } as WorkbenchSidebarAiSurfaceProps;
    const { result } = renderHook(() =>
      useWorkbenchAiSurfaceBridge({
        desktopApi: null,
        sidebarAiSurfaceProps,
        fileEditorModel,
        terminalModel,
        onOpenFileFromManager,
        recordCompletedEditorWorkItem
      })
    );

    act(() => {
      result.current?.onWriteStreamEvent?.(createWriteEvent({
        kind: "finished",
        status: "completed",
        baselineContent: "before\n",
        firstChangedLine: 4,
        addedLines: 2,
        removedLines: 1,
        timestamp: 1030
      }));
    });

    expect(onOpenFileFromManager).toHaveBeenNthCalledWith(
      1,
      "/tmp/app.ts",
      undefined,
      { allowMissing: true }
    );
    expect(onOpenFileFromManager).toHaveBeenNthCalledWith(
      2,
      "/tmp/app.ts",
      { line: 4 },
      { forceReloadIfOpen: true }
    );
    expect(recordCompletedEditorWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "editor-work-tool-1",
        status: "completed",
        filePath: "/tmp/app.ts",
        firstChangedLine: 4,
        addedLines: 2,
        removedLines: 1,
        baselineContent: "before\n"
      })
    );
    expect(fileEditorModel.applyExternalContent).not.toHaveBeenCalled();
  });

  test("does not auto-open the terminal dock for agent commands", () => {
    vi.useFakeTimers();
    const write = vi.fn().mockResolvedValue(undefined);
    const terminalTab = {
      id: "term-1",
      activePaneId: "pane-1",
      paneIds: ["pane-1"]
    };
    let activeDockTab: typeof terminalTab | null = null;
    const terminalModel = {
      get activeDockTab() {
        return activeDockTab;
      },
      openTab: vi.fn(() => {
        activeDockTab = terminalTab;
      })
    } as unknown as TerminalDockModel;
    const desktopApi = {
      terminal: {
        write
      }
    };
    const { result } = renderHook(() =>
      useWorkbenchAiSurfaceBridge({
        desktopApi: desktopApi as never,
        sidebarAiSurfaceProps: { title: "AI" } as WorkbenchSidebarAiSurfaceProps,
        fileEditorModel: {} as FileEditorModel,
        terminalModel,
        onOpenFileFromManager: vi.fn(),
        recordCompletedEditorWorkItem: vi.fn()
      })
    );

    act(() => {
      result.current?.onTerminalExecStarted?.("pnpm test", undefined, "tool-1", "turn-1", "session-1");
      vi.advanceTimersByTime(300);
    });

    expect(terminalModel.openTab).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
