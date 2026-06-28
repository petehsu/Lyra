import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  AgentRuntimeEvent,
  AgentSessionCreateRequest,
  AgentSessionSnapshot,
  AgentTurnStatus
} from "../../../../shared/agent";
import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import {
  resetWorkbenchStateStorageForTests,
  writeWorkbenchStateSync
} from "../../state-storage";
import {
  readAiPanelSessionTabsState,
  useWorkbenchAiSessionTabs
} from "../session-tabs";

const makeSnapshot = (
  id: string,
  title: string,
  turnStatus: AgentTurnStatus = "idle",
  overrides: Partial<AgentSessionSnapshot> = {}
): AgentSessionSnapshot => ({
  id,
  title,
  sessionKind: "normal",
  workingDir: "/",
  projectBound: false,
  messages: [],
  tools: [],
  todos: [],

  turnStatus,
  activeTurnId: turnStatus === "running" ? "turn-1" : null,
  follow: {
    running: turnStatus === "running",
    activity: turnStatus === "running" ? "Working" : null
  },
  updatedAt: "2026-05-13T00:00:00.000Z",
  ...overrides
});

const createDesktopApi = (
  snapshots: Record<string, AgentSessionSnapshot> = {}
) => {
  let listener: ((event: AgentRuntimeEvent) => void) | null = null;
  const createSession = vi.fn(async (request: AgentSessionCreateRequest) =>
    makeSnapshot("created-session", request.title ?? "新会话", "idle", {
      workingDir: request.workingDir ?? "/",
      projectBound: typeof request.workingDir === "string",
      updatedAt: "2026-05-13T00:01:00.000Z"
    })
  );
  const readSession = vi.fn(async (request: { readonly sessionId: string }) =>
    snapshots[request.sessionId]
      ?? makeSnapshot(request.sessionId, `Session ${request.sessionId}`)
  );
  const api = {
    agent: {
      createSession,
      readSession,
      onEvent: vi.fn((next: (event: AgentRuntimeEvent) => void) => {
        listener = next;
        return () => {
          listener = null;
        };
      })
    }
  } as unknown as LyraDesktopApi;

  return {
    api,
    createSession,
    readSession,
    emit: (event: AgentRuntimeEvent) => {
      listener?.(event);
    }
  };
};

describe("AI panel session tabs", () => {
  beforeEach(() => {
    resetWorkbenchStateStorageForTests();
  });

  test("sanitizes persisted tabs and keeps active on a restored tab", () => {
    writeWorkbenchStateSync("ai-panel-tabs", JSON.stringify({
      version: 1,
      tabs: [
        { sessionId: "", title: "Empty" },
        { sessionId: "session-a", title: "   ", lastKnownStatus: "running" },
        { sessionId: "session-a", title: "Duplicate" },
        { sessionId: "session-b", title: "Beta", lastKnownStatus: "unknown" },
        { sessionId: "session-c", title: "Review ⟦page-cite:missing⟧", lastKnownStatus: "idle" }
      ],
      activeSessionId: "missing-session"
    }));

    expect(readAiPanelSessionTabsState()).toEqual({
      tabs: [
        {
          tabId: "session-a",
          sessionId: "session-a",
          title: "新会话",
          lastKnownStatus: "running"
        },
        {
          tabId: "session-b",
          sessionId: "session-b",
          title: "Beta",
          lastKnownStatus: null
        },
        {
          tabId: "session-c",
          sessionId: "session-c",
          title: expect.not.stringContaining("⟦"),
          lastKnownStatus: "idle"
        }
      ],
      activeTabId: "session-a",
      activeSessionId: "session-a"
    });
  });

  test("restores, opens, closes, and creates tabs without destructive agent calls", async () => {
    writeWorkbenchStateSync("ai-panel-tabs", JSON.stringify({
      version: 1,
      tabs: [
        { sessionId: "session-a", title: "Alpha", lastKnownStatus: "idle" },
        { sessionId: "session-b", title: "Beta", lastKnownStatus: "running" }
      ],
      activeSessionId: "session-b"
    }));
    const { api, createSession } = createDesktopApi();
    const { result } = renderHook(() => useWorkbenchAiSessionTabs(api));

    expect(result.current.tabs.map((tab) => tab.sessionId)).toEqual([
      "session-a",
      "session-b"
    ]);
    expect(result.current.activeSessionId).toBe("session-b");

    act(() => {
      result.current.openSession("session-c");
    });
    expect(result.current.activeSessionId).toBe("session-c");
    expect(result.current.tabs.map((tab) => tab.sessionId)).toEqual([
      "session-a",
      "session-b",
      "session-c"
    ]);

    act(() => {
      result.current.openSession("session-a");
    });
    expect(result.current.activeSessionId).toBe("session-a");
    expect(result.current.tabs.filter((tab) => tab.sessionId === "session-a")).toHaveLength(1);

    act(() => {
      result.current.closeSession("session-a");
    });
    expect(result.current.tabs.map((tab) => tab.sessionId)).toEqual([
      "session-b",
      "session-c"
    ]);
    expect(result.current.activeSessionId).toBe("session-b");

    await act(async () => {
      await result.current.createSession({
        title: "Created",
        workingDir: "/Users/petehsu/Documents/Lyra"
      });
    });

    expect(createSession).toHaveBeenCalledWith({
      title: "Created",
      workingDir: "/Users/petehsu/Documents/Lyra"
    });
    expect(result.current.activeSessionId).toBe("created-session");
    expect(result.current.tabs.at(-1)).toMatchObject({
      sessionId: "created-session",
      title: "Created"
    });
  });

  test("creates draft tabs, reorders tabs, and removes deleted sessions", () => {
    writeWorkbenchStateSync("ai-panel-tabs", JSON.stringify({
      version: 2,
      tabs: [
        { tabId: "session-a", sessionId: "session-a", title: "Alpha", lastKnownStatus: "idle" },
        { tabId: "session-b", sessionId: "session-b", title: "Beta", lastKnownStatus: "idle" }
      ],
      activeTabId: "session-a",
      activeSessionId: "session-a"
    }));
    const { api, createSession } = createDesktopApi();
    const { result } = renderHook(() => useWorkbenchAiSessionTabs(api));

    act(() => {
      result.current.createDraftSession({
        title: "新会话",
        workingDir: "/Users/petehsu/Documents/Lyra"
      });
    });

    const draft = result.current.activeTab;
    expect(createSession).not.toHaveBeenCalled();
    expect(draft).toMatchObject({
      sessionId: null,
      title: "新会话",
      draftWorkingDir: "/Users/petehsu/Documents/Lyra"
    });
    expect(result.current.activeSessionId).toBeNull();

    act(() => {
      result.current.reorderSessionTabs(draft!.tabId, "session-a");
    });
    expect(result.current.tabs[0]?.tabId).toBe(draft?.tabId);

    act(() => {
      result.current.removeSession("session-b");
    });
    expect(result.current.tabs.some((tab) => tab.sessionId === "session-b")).toBe(false);
    expect(result.current.activeTabId).toBe(draft?.tabId);
  });

  test("updates background tab running and idle summaries from runtime events", async () => {
    writeWorkbenchStateSync("ai-panel-tabs", JSON.stringify({
      version: 1,
      tabs: [
        { sessionId: "session-a", title: "Alpha", lastKnownStatus: "idle" },
        { sessionId: "session-b", title: "Beta", lastKnownStatus: "idle" }
      ],
      activeSessionId: "session-a"
    }));
    const { api, emit, readSession } = createDesktopApi({
      "session-b": makeSnapshot("session-b", "Beta finished", "idle", {
        updatedAt: "2026-05-13T00:02:00.000Z"
      })
    });
    const { result } = renderHook(() => useWorkbenchAiSessionTabs(api));

    act(() => {
      emit({
        kind: "turnStarted",
        sessionId: "session-b",
        turnId: "turn-b",
        state: "calling_model"
      });
    });

    expect(result.current.tabs.find((tab) => tab.sessionId === "session-b"))
      .toMatchObject({ lastKnownStatus: "running" });
    expect(result.current.activeSessionId).toBe("session-a");

    act(() => {
      emit({
        kind: "turnFinished",
        sessionId: "session-b",
        turnId: "turn-b",
        status: "finished"
      });
    });

    await waitFor(() => {
      expect(readSession).toHaveBeenCalledWith({ sessionId: "session-b" });
      expect(result.current.tabs.find((tab) => tab.sessionId === "session-b"))
        .toMatchObject({
          title: "Beta finished",
          lastKnownStatus: "idle",
          updatedAt: "2026-05-13T00:02:00.000Z"
        });
    });
    expect(result.current.activeSessionId).toBe("session-a");
  });

  test("maps backend cancelled runtime events to cancelled tab status", () => {
    writeWorkbenchStateSync("ai-panel-tabs", JSON.stringify({
      version: 1,
      tabs: [
        { sessionId: "session-a", title: "Alpha", lastKnownStatus: "running" }
      ],
      activeSessionId: "session-a"
    }));
    const { api, emit } = createDesktopApi();
    const { result } = renderHook(() => useWorkbenchAiSessionTabs(api));

    act(() => {
      emit({
        kind: "turnStateChanged",
        sessionId: "session-a",
        turnId: "turn-a",
        state: "cancelled"
      });
    });

    expect(result.current.tabs[0]).toMatchObject({
      sessionId: "session-a",
      lastKnownStatus: "cancelled"
    });
  });
});
