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

const consoleBridgeMock = vi.hoisted(() => {
  const open = vi.fn(async ({ vmId, vncPort }: { readonly vmId: string; readonly vncPort: number }) => ({
    vmId,
    vncPort,
    url: `ws://127.0.0.1:59000/agent-vm/${vmId}`
  }));
  const dispose = vi.fn();
  return {
    open,
    dispose,
    createAgentVmConsoleBridge: vi.fn(() => ({ open, dispose }))
  };
});

vi.mock("electron", () => ({
  ipcMain: electronMock.ipcMain
}));

vi.mock("../agent-vm-console", () => ({
  createAgentVmConsoleBridge: consoleBridgeMock.createAgentVmConsoleBridge
}));

import { LYRA_CHANNELS } from "../../../shared/desktop-bridge";
import type { LyraRuntimeClient } from "../../runtime-client";
import { createAiIpcBridge } from "../service";

describe("AI IPC bridge", () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.ipcMain.handle.mockClear();
    electronMock.ipcMain.removeHandler.mockClear();
    consoleBridgeMock.open.mockClear();
    consoleBridgeMock.dispose.mockClear();
    consoleBridgeMock.createAgentVmConsoleBridge.mockClear();
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
      electronMock.handlers.get(LYRA_CHANNELS.aiUpdateSession)?.({}, {
        sessionId: "session-a",
        modelId: "gpt-5.4",
        systemPrompt: "Answer tersely.",
        permissionMode: "full_access"
      })
    ).resolves.toEqual({
      method: "agent.sessions.update",
      payload: {
        sessionId: "session-a",
        modelId: "gpt-5.4",
        systemPrompt: "Answer tersely.",
        permissionMode: "full_access",
        storageRoot: "/tmp/lyra-ai-test"
      }
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
      electronMock.handlers.get(LYRA_CHANNELS.aiResolveClarification)?.({}, {
        sessionId: "session-a",
        questionTicketId: "question-1",
        selectedOptionId: "B"
      })
    ).resolves.toEqual({
      method: "agent.clarification.resolve",
      payload: {
        sessionId: "session-a",
        questionTicketId: "question-1",
        selectedOptionId: "B",
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
      method: "agent.approval.deny_and_resume_tool",
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
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiUpdateSession);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiCreateTodo);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiCreatePlan);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiResolvePlanReview);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiResolveClarification);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiReadFollow);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiPauseFollow);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiResumeFollow);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiPreviewMessageRollback);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiExecuteMessageRollback);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiReadArtifact);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiApplyPatch);
  });

  test("forwards Agent VM channels to runtime methods", async () => {
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
      electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmList)?.({}, { sessionId: "session-a" })
    ).resolves.toEqual({
      method: "agent.vm.list",
      payload: { sessionId: "session-a", storageRoot: "/tmp/lyra-ai-test" }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmListImages)?.({}, {})
    ).resolves.toEqual({
      method: "agent.vm.images.list",
      payload: { storageRoot: "/tmp/lyra-ai-test" }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmDownloadImage)?.({}, {
        imageId: "lyra-agent-lite-ubuntu-24.04"
      })
    ).resolves.toEqual({
      method: "agent.vm.image.download",
      payload: {
        imageId: "lyra-agent-lite-ubuntu-24.04",
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmImportImage)?.({}, {
        imageId: "debian-agent-minimal",
        filePath: "/tmp/debian.qcow2"
      })
    ).resolves.toEqual({
      method: "agent.vm.image.import",
      payload: {
        imageId: "debian-agent-minimal",
        filePath: "/tmp/debian.qcow2",
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmCreate)?.({}, {
        sessionId: "session-a",
        imageId: "debian-agent-minimal"
      })
    ).resolves.toEqual({
      method: "agent.vm.create",
      payload: {
        sessionId: "session-a",
        imageId: "debian-agent-minimal",
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmListBindings)?.({}, { sessionId: "session-a" })
    ).resolves.toEqual({
      method: "agent.vm.bindings.list",
      payload: { sessionId: "session-a", storageRoot: "/tmp/lyra-ai-test" }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmReadBinding)?.({}, {
        sessionId: "session-a",
        vmId: "vm-a"
      })
    ).resolves.toEqual({
      method: "agent.vm.binding.read",
      payload: { sessionId: "session-a", vmId: "vm-a", storageRoot: "/tmp/lyra-ai-test" }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmAttach)?.({}, {
        sessionId: "session-a",
        vmId: "vm-a",
        attachMode: "shared"
      })
    ).resolves.toEqual({
      method: "agent.vm.attach",
      payload: {
        sessionId: "session-a",
        vmId: "vm-a",
        attachMode: "shared",
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmTakeover)?.({}, {
        sessionId: "session-a",
        vmId: "vm-a",
        reason: "user_requested"
      })
    ).resolves.toEqual({
      method: "agent.vm.takeover",
      payload: {
        sessionId: "session-a",
        vmId: "vm-a",
        reason: "user_requested",
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmFork)?.({}, {
        sessionId: "session-a",
        sourceVmId: "vm-a",
        targetVmId: "vm-b"
      })
    ).resolves.toEqual({
      method: "agent.vm.fork",
      payload: {
        sessionId: "session-a",
        sourceVmId: "vm-a",
        targetVmId: "vm-b",
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmCreateInheritanceProfile)?.({}, {
        sessionId: "session-a",
        sourceVmId: "vm-a",
        include: ["login_state", "package_cache"]
      })
    ).resolves.toEqual({
      method: "agent.vm.inheritance.create",
      payload: {
        sessionId: "session-a",
        sourceVmId: "vm-a",
        include: ["login_state", "package_cache"],
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmApplyInheritanceProfile)?.({}, {
        sessionId: "session-a",
        profileId: "inherit-a"
      })
    ).resolves.toEqual({
      method: "agent.vm.inheritance.apply",
      payload: {
        sessionId: "session-a",
        profileId: "inherit-a",
        storageRoot: "/tmp/lyra-ai-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmRevokeBinding)?.({}, {
        sessionId: "session-a",
        vmId: "vm-a"
      })
    ).resolves.toEqual({
      method: "agent.vm.binding.revoke",
      payload: { sessionId: "session-a", vmId: "vm-a", storageRoot: "/tmp/lyra-ai-test" }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmStatus)?.({}, { vmId: "vm-a" })
    ).resolves.toEqual({
      method: "agent.vm.status",
      payload: { vmId: "vm-a", storageRoot: "/tmp/lyra-ai-test" }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmStart)?.({}, { vmId: "vm-a" })
    ).resolves.toEqual({
      method: "agent.vm.start",
      payload: { vmId: "vm-a", storageRoot: "/tmp/lyra-ai-test" }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmStop)?.({}, { vmId: "vm-a" })
    ).resolves.toEqual({
      method: "agent.vm.stop",
      payload: { vmId: "vm-a", storageRoot: "/tmp/lyra-ai-test" }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmPasswordMetadata)?.({}, { vmId: "vm-a" })
    ).resolves.toEqual({
      method: "agent.vm.password.metadata",
      payload: { vmId: "vm-a", storageRoot: "/tmp/lyra-ai-test" }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmPasswordReveal)?.({}, { vmId: "vm-a" })
    ).resolves.toEqual({
      method: "agent.vm.password.reveal",
      payload: { vmId: "vm-a", storageRoot: "/tmp/lyra-ai-test" }
    });

    bridge.dispose();
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmList);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmListImages);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmDownloadImage);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmImportImage);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmCreate);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmListBindings);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmReadBinding);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmAttach);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmTakeover);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmFork);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmCreateInheritanceProfile);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmApplyInheritanceProfile);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmRevokeBinding);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmStatus);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmStart);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmStop);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmPasswordMetadata);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmPasswordReveal);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiAgentVmConsoleConnect);
  });

  test("opens Agent VM console bridge only for running VNC-backed VMs", async () => {
    const request = vi.fn(async () => ({
      status: "running",
      capsule: {
        state: "running",
        vncPort: 5901
      }
    }));
    const bridge = createAiIpcBridge({
      runtimeClient: {
        request,
        subscribe: vi.fn(() => vi.fn()),
      } as unknown as LyraRuntimeClient,
      storageRoot: "/tmp/lyra-ai-test"
    });

    const result = await electronMock.handlers.get(LYRA_CHANNELS.aiAgentVmConsoleConnect)?.(
      {},
      { vmId: "vm-a" }
    );

    expect(request).toHaveBeenCalledWith("agent.vm.status", {
      vmId: "vm-a",
      storageRoot: "/tmp/lyra-ai-test"
    });
    expect(result).toMatchObject({
      vmId: "vm-a",
      vncPort: 5901
    });
    expect((result as { url: string }).url).toBe("ws://127.0.0.1:59000/agent-vm/vm-a");
    expect(consoleBridgeMock.open).toHaveBeenCalledWith({
      vmId: "vm-a",
      vncPort: 5901
    });

    bridge.dispose();
    expect(consoleBridgeMock.dispose).toHaveBeenCalled();
  });
});
