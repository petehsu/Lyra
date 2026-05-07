import { beforeEach, describe, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => unknown;
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel);
      })
    }
  };
});

vi.mock("electron", () => ({
  ipcMain: electronMock.ipcMain
}));

import { LYRA_CHANNELS } from "../../../shared/desktop-bridge";
import type { LyraRuntimeClient } from "../../runtime-client";
import { createAiIpcBridge } from "../service";

describe("AI IPC bridge", () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.ipcMain.handle.mockClear();
    electronMock.ipcMain.removeHandler.mockClear();
  });

  test("forwards Settings AI channels to runtime model config methods", async () => {
    const request = vi.fn(async (method: string, payload: unknown) => ({
      method,
      payload
    }));
    const bridge = createAiIpcBridge({
      runtimeClient: {
        request,
        subscribe: vi.fn(() => vi.fn()),
      } as unknown as LyraRuntimeClient,
      storageRoot: "/tmp/lyra-ai-test"
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiReadConfig)?.({})
    ).resolves.toEqual({
      method: "model.config.read",
      payload: { storageRoot: "/tmp/lyra-ai-test" }
    });

    const upsertPayload = {
      id: "profile-openai",
      providerId: "openai",
      model: "gpt-5"
    };
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiUpsertProfile)?.({}, upsertPayload)
    ).resolves.toEqual({
      method: "model.profile.upsert",
      payload: { ...upsertPayload, storageRoot: "/tmp/lyra-ai-test" }
    });

    const discoverPayload = {
      providerId: "openai",
      model: "gpt-5"
    };
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiDiscoverModels)?.({}, discoverPayload)
    ).resolves.toEqual({
      method: "model.models.discover",
      payload: { ...discoverPayload, storageRoot: "/tmp/lyra-ai-test" }
    });

    bridge.dispose();
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiReadConfig);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiDiscoverModels);
  });

  test("forwards Agent session channels and runtime events", async () => {
    let runtimeListener: ((event: string, payload: unknown) => void) | null = null;
    const request = vi.fn(async (method: string, payload: unknown) => ({
      method,
      payload
    }));
    const send = vi.fn();
    const unsubscribe = vi.fn();
    const bridge = createAiIpcBridge({
      runtimeClient: {
        request,
        subscribe: vi.fn((listener) => {
          runtimeListener = listener;
          return unsubscribe;
        }),
      } as unknown as LyraRuntimeClient,
      storageRoot: "/tmp/lyra-ai-test",
      getWindow: () => ({
        isDestroyed: () => false,
        webContents: { send },
      }) as never,
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiListSessions)?.({})
    ).resolves.toEqual({
      method: "agent.sessions.list",
      payload: { storageRoot: "/tmp/lyra-ai-test" }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiCreateSession)?.({}, { title: "New" })
    ).resolves.toEqual({
      method: "agent.sessions.create",
      payload: { title: "New", storageRoot: "/tmp/lyra-ai-test" }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiSendTurn)?.({}, {
        sessionId: "session-a",
        input: { text: "hello", attachments: [] }
      })
    ).resolves.toEqual({
      method: "agent.turn.send",
      payload: {
        sessionId: "session-a",
        input: { text: "hello", attachments: [] },
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiReadArtifact)?.({}, {
        sessionId: "session-a",
        patchRef: "tool_result_patch"
      })
    ).resolves.toEqual({
      method: "agent.artifact.read",
      payload: {
        sessionId: "session-a",
        patchRef: "tool_result_patch",
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiCreateTodo)?.({}, {
        sessionId: "session-a",
        kind: "plan_bound",
        title: "Plan",
        items: [{ title: "Apply patch", expectedTools: ["/tools/filesystem/apply_patch"] }]
      })
    ).resolves.toEqual({
      method: "agent.todo.create",
      payload: {
        sessionId: "session-a",
        kind: "plan_bound",
        title: "Plan",
        items: [{ title: "Apply patch", expectedTools: ["/tools/filesystem/apply_patch"] }],
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiCreatePlan)?.({}, {
        sessionId: "session-a",
        title: "Plan",
        objectiveSummary: "Do the work",
        version: { steps: [{ title: "Apply patch" }] }
      })
    ).resolves.toEqual({
      method: "agent.plan.create",
      payload: {
        sessionId: "session-a",
        title: "Plan",
        objectiveSummary: "Do the work",
        version: { steps: [{ title: "Apply patch" }] },
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiReadFollow)?.({}, {
        sessionId: "session-a"
      })
    ).resolves.toEqual({
      method: "agent.follow.read",
      payload: {
        sessionId: "session-a",
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiPauseFollow)?.({}, {
        sessionId: "session-a",
        followSessionId: "follow-session-1"
      })
    ).resolves.toEqual({
      method: "agent.follow.pause",
      payload: {
        sessionId: "session-a",
        followSessionId: "follow-session-1",
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiResumeFollow)?.({}, {
        sessionId: "session-a"
      })
    ).resolves.toEqual({
      method: "agent.follow.resume",
      payload: {
        sessionId: "session-a",
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiPreviewMessageRollback)?.({}, {
        sessionId: "session-a",
        targetUserMessageId: "msg-user"
      })
    ).resolves.toEqual({
      method: "agent.rollback.preview",
      payload: {
        sessionId: "session-a",
        targetUserMessageId: "msg-user",
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiExecuteMessageRollback)?.({}, {
        sessionId: "session-a",
        rollbackId: "rollback-1",
        confirmationToken: "restore"
      })
    ).resolves.toEqual({
      method: "agent.rollback.execute",
      payload: {
        sessionId: "session-a",
        rollbackId: "rollback-1",
        confirmationToken: "restore",
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiResolvePlanReview)?.({}, {
        sessionId: "session-a",
        planId: "plan-1",
        versionId: "plan-version-1",
        decision: "approve"
      })
    ).resolves.toEqual({
      method: "agent.plan.review.resolve",
      payload: {
        sessionId: "session-a",
        planId: "plan-1",
        versionId: "plan-version-1",
        decision: "approve",
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiApplyPatch)?.({}, {
        sessionId: "session-a",
        artifactId: "artifact_patch_1"
      })
    ).resolves.toEqual({
      method: "agent.patch.apply",
      payload: {
        sessionId: "session-a",
        artifactId: "artifact_patch_1",
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiResolveApproval)?.({}, {
        sessionId: "session-a",
        approvalTicketId: "approval-1",
        decision: "deny"
      })
    ).resolves.toEqual({
      method: "agent.approval.resolve",
      payload: {
        sessionId: "session-a",
        approvalTicketId: "approval-1",
        decision: "deny",
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    const eventPayload = {
      schemaVersion: "v1",
      eventId: "event-a",
      sequence: 1,
      sessionId: "session-a",
      runtimeTurnId: "turn-a",
      eventType: "model_text_delta",
      payload: { delta: "hi" },
      createdAt: "2026-05-06T00:00:00Z"
    };
    expect(runtimeListener).not.toBeNull();
    (runtimeListener as unknown as (event: string, payload: unknown) => void)(
      "agent.runtime",
      eventPayload
    );
    expect(send).toHaveBeenCalledWith(LYRA_CHANNELS.aiEvent, eventPayload);

    bridge.dispose();
    expect(unsubscribe).toHaveBeenCalled();
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiSendTurn);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiCancelTurn);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiCreateTodo);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiCreatePlan);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiResolvePlanReview);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiReadFollow);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiPauseFollow);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiResumeFollow);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiPreviewMessageRollback);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiExecuteMessageRollback);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiReadArtifact);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiApplyPatch);
  });
});
