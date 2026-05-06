import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { resetWorkbenchStateStorageForTests } from "../../state-storage";
import type { AgentRuntimeStreamEvent, LyraDesktopApi } from "../../../../shared/desktop-bridge";
import type { AgentSessionDetail } from "../agent-ui-types";
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

  test("runtime actions report a missing desktop AI bridge", async () => {
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
    expect(result.current.state.runtimeError).toBe("AI runtime is not connected");
    expect(result.current.state.isSending).toBe(false);
  });

  test("projects live tool runtime events into the active thread detail", async () => {
    let listener: ((event: AgentRuntimeStreamEvent) => void) | null = null;
    const detail = createDetail();
    const desktopApi = {
      ai: {
        listSessions: vi.fn().mockResolvedValue([]),
        createSession: vi.fn().mockResolvedValue(detail),
        readSession: vi.fn().mockResolvedValue(detail),
        updateSession: vi.fn(),
        sendTurn: vi.fn(),
        cancelTurn: vi.fn(),
        readConfig: vi.fn(),
        upsertProfile: vi.fn(),
        deleteProfile: vi.fn(),
        discoverModels: vi.fn(),
        onAgentEvent: (nextListener: (event: AgentRuntimeStreamEvent) => void) => {
          listener = nextListener;
          return () => {};
        },
      },
    } as unknown as LyraDesktopApi;
    const { result } = renderHook(() =>
      useLyraThreadRuntime({
        desktopApi,
      })
    );

    await act(async () => {
      await result.current.actions.createThread({ cwd: "/repo" });
    });
    act(() => {
      listener?.({
        schemaVersion: "v1",
        eventId: "event-tool",
        sequence: 1,
        sessionId: "session-1",
        runtimeTurnId: "turn-1",
        eventType: "tool_operation_started",
        payload: {
          operation: {
            schemaVersion: "v1",
            opId: "op-read",
            op: "run",
            path: "/tools/filesystem/read_file",
            toolPath: "/tools/filesystem/read_file",
            riskLevel: "low",
            summary: "Run /tools/filesystem/read_file",
          },
        },
        createdAt: "2026-05-06T00:00:00.000Z",
      });
    });

    expect(result.current.state.activeDetail?.runtimeEvents).toEqual([
      {
        sessionId: "session-1",
        turnId: "turn-1",
        phase: "tool_operation_started",
        payload: {
          operation: {
            schemaVersion: "v1",
            opId: "op-read",
            op: "run",
            path: "/tools/filesystem/read_file",
            toolPath: "/tools/filesystem/read_file",
            riskLevel: "low",
            summary: "Run /tools/filesystem/read_file",
          },
        },
        timestamp: Date.parse("2026-05-06T00:00:00.000Z"),
      },
    ]);

    act(() => {
      listener?.({
        schemaVersion: "v1",
        eventId: "event-patch",
        sequence: 2,
        sessionId: "session-1",
        runtimeTurnId: "turn-1",
        eventType: "tool_operation_completed",
        payload: {
          operation: {
            schemaVersion: "v1",
            opId: "op-propose",
            op: "run",
            path: "/tools/filesystem/propose_patch",
            toolPath: "/tools/filesystem/propose_patch",
            riskLevel: "medium",
            summary: "Run /tools/filesystem/propose_patch",
          },
          result: {
            resultRef: "tool_result_patch",
            patchRef: "tool_result_patch",
            artifactId: "artifact_patch_1",
            evidenceId: "evidence_patch_1",
            summary: "Proposed patch for 1 file",
            changedFiles: [{ path: "README.md", changeType: "modified", additions: 1, deletions: 0 }],
          },
        },
        createdAt: "2026-05-06T00:00:01.000Z",
      });
    });

    expect(result.current.state.activeDetail?.runtimeEvents.at(1)?.payload).toMatchObject({
      result: {
        patchRef: "tool_result_patch",
        artifactId: "artifact_patch_1",
        changedFiles: [{ path: "README.md" }],
      },
    });
  });

  test("applyPatch refreshes session detail from the runtime", async () => {
    const detail = createDetail();
    const appliedDetail = {
      ...detail,
      runtimeEvents: [
        {
          sessionId: "session-1",
          turnId: "turn-1",
          phase: "tool_operation_completed",
          payload: {
            operation: { path: "/tools/filesystem/apply_patch" },
            result: {
              status: "applied",
              artifactId: "artifact_applied",
              appliedFromArtifactId: "artifact_patch_1",
              patchRef: "tool_result_patch",
            },
          },
          timestamp: 2,
        },
      ],
    } satisfies AgentSessionDetail;
    const desktopApi = {
      ai: {
        listSessions: vi.fn().mockResolvedValue([]),
        createSession: vi.fn().mockResolvedValue(detail),
        readSession: vi.fn().mockResolvedValue(appliedDetail),
        updateSession: vi.fn(),
        sendTurn: vi.fn(),
        cancelTurn: vi.fn(),
        applyPatch: vi.fn().mockResolvedValue({
          sessionId: "session-1",
          turnId: "turn-1",
          status: "applied",
          detail: "Patch applied",
          approvalTicketId: "approval-1",
          artifactId: "artifact_applied",
          evidenceId: "evidence_applied",
          patchRef: "tool_result_patch",
          changedFiles: [],
        }),
        readConfig: vi.fn(),
        upsertProfile: vi.fn(),
        deleteProfile: vi.fn(),
        discoverModels: vi.fn(),
        onAgentEvent: () => () => {},
      },
    } as unknown as LyraDesktopApi;
    const { result } = renderHook(() =>
      useLyraThreadRuntime({
        desktopApi,
      })
    );

    await act(async () => {
      await result.current.actions.createThread({ cwd: "/repo" });
      await result.current.actions.applyPatch({
        sessionId: "session-1",
        artifactId: "artifact_patch_1",
      });
    });

    expect(desktopApi.ai.applyPatch).toHaveBeenCalledWith({
      sessionId: "session-1",
      artifactId: "artifact_patch_1",
    });
    expect(desktopApi.ai.readSession).toHaveBeenCalledWith({ sessionId: "session-1" });
    expect(result.current.state.activeDetail?.runtimeEvents).toHaveLength(1);
  });

  test("resolveApproval refreshes session detail from the runtime", async () => {
    const detail = createDetail();
    const refreshedDetail = {
      ...detail,
      pendingInteractions: [],
      runtimeEvents: [
        {
          sessionId: "session-1",
          turnId: "turn-1",
          phase: "approval_ticket_resolved",
          payload: {
            decision: "deny",
            status: "denied",
            toolPath: "/tools/filesystem/apply_patch",
            approvalTicketId: "approval-1",
          },
          timestamp: 2,
        },
      ],
    } satisfies AgentSessionDetail;
    const desktopApi = {
      ai: {
        listSessions: vi.fn().mockResolvedValue([]),
        createSession: vi.fn().mockResolvedValue(detail),
        readSession: vi.fn().mockResolvedValue(refreshedDetail),
        updateSession: vi.fn(),
        sendTurn: vi.fn(),
        cancelTurn: vi.fn(),
        resolveApproval: vi.fn().mockResolvedValue({
          sessionId: "session-1",
          approvalTicketId: "approval-1",
          status: "denied",
          detail: "User denied tool approval",
          toolPath: "/tools/filesystem/apply_patch",
          changedFiles: [],
        }),
        readConfig: vi.fn(),
        upsertProfile: vi.fn(),
        deleteProfile: vi.fn(),
        discoverModels: vi.fn(),
        onAgentEvent: () => () => {},
      },
    } as unknown as LyraDesktopApi;
    const { result } = renderHook(() =>
      useLyraThreadRuntime({
        desktopApi,
      })
    );

    await act(async () => {
      await result.current.actions.createThread({ cwd: "/repo" });
      await result.current.actions.resolveApproval({
        sessionId: "session-1",
        approvalTicketId: "approval-1",
        decision: "deny",
      });
    });

    expect(desktopApi.ai.resolveApproval).toHaveBeenCalledWith({
      sessionId: "session-1",
      approvalTicketId: "approval-1",
      decision: "deny",
    });
    expect(desktopApi.ai.readSession).toHaveBeenCalledWith({ sessionId: "session-1" });
    expect(result.current.state.activeDetail?.pendingInteractions).toHaveLength(0);
  });
});

const createDetail = (): AgentSessionDetail => ({
  session: {
    id: "session-1",
    title: "Project",
    profileId: "profile-1",
    projectRoot: "/repo",
    projectName: "repo",
    collaborationMode: "default",
    createdAt: 1,
    updatedAt: 1,
  },
  pendingInteractions: [],
  turns: [
    {
      id: "turn-1",
      sessionId: "session-1",
      profileId: "profile-1",
      status: "running",
      collaborationMode: "default",
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  messages: [
    {
      id: "msg-user",
      sessionId: "session-1",
      turnId: "turn-1",
      role: "user",
      content: "Inspect README",
      displayContent: "Inspect README",
      createdAt: 1,
    },
  ],
  runtimeEvents: [],
});
