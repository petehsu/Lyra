import { ipcMain } from "electron";

import {
  LYRA_CHANNELS,
  type AgentCancelTurnRequest,
  type AgentCancelTurnResult,
  type AgentExecuteMessageRollbackRequest,
  type AgentExecuteMessageRollbackResult,
  type AgentApplyPatchRequest,
  type AgentApplyPatchResult,
  type AgentArtifactContent,
  type AgentCreatePlanRequest,
  type AgentCreatePlanResult,
  type AgentCreateSessionRequest,
  type AgentCreateTodoRequest,
  type AgentCreateTodoResult,
  type AgentFollowSummary,
  type AgentPauseFollowRequest,
  type AgentPreviewMessageRollbackRequest,
  type AgentPreviewMessageRollbackResult,
  type AgentReadArtifactRequest,
  type AgentReadFollowRequest,
  type AgentReadSessionRequest,
  type AgentResolveApprovalRequest,
  type AgentResolveApprovalResult,
  type AgentResolveClarificationRequest,
  type AgentResolveClarificationResult,
  type AgentResolvePlanReviewRequest,
  type AgentResolvePlanReviewResult,
  type AgentResumeFollowRequest,
  type AgentRuntimeStreamEvent,
  type AgentSendTurnRequest,
  type AgentSendTurnResult,
  type AgentSession,
  type AgentSessionDetail,
  type AgentUpdateSessionRequest,
  type AgentVmApplyInheritanceProfileRequest,
  type AgentVmApplyInheritanceProfileResult,
  type AgentVmAttachRequest,
  type AgentVmBindingListRequest,
  type AgentVmBindingListResult,
  type AgentVmBindingResult,
  type AgentVmCreateRequest,
  type AgentVmCreateResult,
  type AgentVmConsoleConnectRequest,
  type AgentVmConsoleConnectResult,
  type AgentVmCreateInheritanceProfileRequest,
  type AgentVmForkRequest,
  type AgentVmImageDownloadRequest,
  type AgentVmImageDownloadResult,
  type AgentVmImageImportRequest,
  type AgentVmImageImportResult,
  type AgentVmImageListRequest,
  type AgentVmImageListResult,
  type AgentVmInheritanceProfileResult,
  type AgentVmLifecycleResult,
  type AgentVmListRequest,
  type AgentVmListResult,
  type AgentVmPasswordMetadataRequest,
  type AgentVmPasswordMetadataResult,
  type AgentVmPasswordRevealRequest,
  type AgentVmPasswordRevealResult,
  type AgentVmReadBindingRequest,
  type AgentVmRevokeBindingRequest,
  type AgentVmStatusRequest,
  type AgentVmTakeoverRequest,
  type AiDeleteProfileRequest,
  type AiDiscoverModelsRequest,
  type AiModelDiscoveryResult,
  type AiProviderProfile,
  type AiRuntimeConfigSnapshot,
  type AiUpsertProfileRequest
} from "../../shared/desktop-bridge";
import type { LyraRuntimeClient } from "../runtime-client";
import { createAgentVmConsoleBridge } from "./agent-vm-console";

type AiBridgeOptions = {
  readonly runtimeClient: LyraRuntimeClient;
  readonly storageRoot: string;
  readonly getWindow?: () => Electron.BrowserWindow | null;
};

const AI_RUNTIME_EVENT_NAME = "agent.runtime";

type AgentVmStatusPayload = AgentVmLifecycleResult & {
  readonly status?: unknown;
  readonly capsule?: {
    readonly state?: unknown;
    readonly vncPort?: unknown;
  };
};

const resolveRunningVncPort = (payload: AgentVmStatusPayload): number => {
  const state = typeof payload.capsule?.state === "string"
    ? payload.capsule.state
    : typeof payload.status === "string"
      ? payload.status
      : "unknown";
  if (state !== "running") {
    throw new Error("AgentVmConsoleUnavailable: VM is not running");
  }
  const vncPort = payload.capsule?.vncPort;
  if (typeof vncPort !== "number" || !Number.isInteger(vncPort)) {
    throw new Error("AgentVmConsoleUnavailable: VM has no console port");
  }
  return vncPort;
};

export const createAiIpcBridge = ({
  runtimeClient,
  storageRoot,
  getWindow
}: AiBridgeOptions): { readonly dispose: () => void } => {
  const withStorageRoot = <T extends object>(payload: T): T & { readonly storageRoot: string } => ({
    ...payload,
    storageRoot
  });
  const requestRuntime = async <T>(method: string, payload: object = {}): Promise<T> =>
    runtimeClient.request<T>(method, withStorageRoot(payload));
  const consoleBridge = createAgentVmConsoleBridge();
  const unsubscribeRuntimeEvents = runtimeClient.subscribe((eventName, payload) => {
    if (eventName !== AI_RUNTIME_EVENT_NAME) {
      return;
    }
    const window = getWindow?.() ?? null;
    if (window === null || window.isDestroyed()) {
      return;
    }
    window.webContents.send(LYRA_CHANNELS.aiEvent, payload as AgentRuntimeStreamEvent);
  });

  ipcMain.handle(
    LYRA_CHANNELS.aiReadConfig,
    async (): Promise<AiRuntimeConfigSnapshot> =>
      requestRuntime<AiRuntimeConfigSnapshot>("model.config.read")
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiUpsertProfile,
    async (_event, request: AiUpsertProfileRequest): Promise<AiProviderProfile> =>
      requestRuntime<AiProviderProfile>("model.profile.upsert", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiDeleteProfile,
    async (_event, request: AiDeleteProfileRequest): Promise<void> => {
      await requestRuntime<void>("model.profile.delete", request);
    }
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiDiscoverModels,
    async (_event, request: AiDiscoverModelsRequest): Promise<AiModelDiscoveryResult> =>
      requestRuntime<AiModelDiscoveryResult>("model.models.discover", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiListSessions,
    async (): Promise<readonly AgentSession[]> =>
      requestRuntime<readonly AgentSession[]>("agent.sessions.list")
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiCreateSession,
    async (_event, request: AgentCreateSessionRequest): Promise<AgentSessionDetail> =>
      requestRuntime<AgentSessionDetail>("agent.sessions.create", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiReadSession,
    async (_event, request: AgentReadSessionRequest): Promise<AgentSessionDetail> =>
      requestRuntime<AgentSessionDetail>("agent.sessions.read", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiUpdateSession,
    async (_event, request: AgentUpdateSessionRequest): Promise<AgentSessionDetail> =>
      requestRuntime<AgentSessionDetail>("agent.sessions.update", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiReadFollow,
    async (_event, request: AgentReadFollowRequest): Promise<AgentFollowSummary | null> =>
      requestRuntime<AgentFollowSummary | null>("agent.follow.read", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiPauseFollow,
    async (_event, request: AgentPauseFollowRequest): Promise<AgentFollowSummary | null> =>
      requestRuntime<AgentFollowSummary | null>("agent.follow.pause", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiResumeFollow,
    async (_event, request: AgentResumeFollowRequest): Promise<AgentFollowSummary | null> =>
      requestRuntime<AgentFollowSummary | null>("agent.follow.resume", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiPreviewMessageRollback,
    async (_event, request: AgentPreviewMessageRollbackRequest): Promise<AgentPreviewMessageRollbackResult> =>
      requestRuntime<AgentPreviewMessageRollbackResult>("agent.rollback.preview", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiExecuteMessageRollback,
    async (_event, request: AgentExecuteMessageRollbackRequest): Promise<AgentExecuteMessageRollbackResult> =>
      requestRuntime<AgentExecuteMessageRollbackResult>("agent.rollback.execute", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiSendTurn,
    async (_event, request: AgentSendTurnRequest): Promise<AgentSendTurnResult> =>
      requestRuntime<AgentSendTurnResult>("agent.turn.send", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiCancelTurn,
    async (_event, request: AgentCancelTurnRequest): Promise<AgentCancelTurnResult> =>
      requestRuntime<AgentCancelTurnResult>("agent.turn.cancel", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiCreateTodo,
    async (_event, request: AgentCreateTodoRequest): Promise<AgentCreateTodoResult> =>
      requestRuntime<AgentCreateTodoResult>("agent.todo.create", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiCreatePlan,
    async (_event, request: AgentCreatePlanRequest): Promise<AgentCreatePlanResult> =>
      requestRuntime<AgentCreatePlanResult>("agent.plan.create", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiResolvePlanReview,
    async (_event, request: AgentResolvePlanReviewRequest): Promise<AgentResolvePlanReviewResult> =>
      requestRuntime<AgentResolvePlanReviewResult>("agent.plan.review.resolve", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiResolveClarification,
    async (_event, request: AgentResolveClarificationRequest): Promise<AgentResolveClarificationResult> =>
      requestRuntime<AgentResolveClarificationResult>("agent.clarification.resolve", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiReadArtifact,
    async (_event, request: AgentReadArtifactRequest): Promise<AgentArtifactContent> =>
      requestRuntime<AgentArtifactContent>("agent.artifact.read", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiApplyPatch,
    async (_event, request: AgentApplyPatchRequest): Promise<AgentApplyPatchResult> =>
      requestRuntime<AgentApplyPatchResult>("agent.patch.apply", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiResolveApproval,
    async (_event, request: AgentResolveApprovalRequest): Promise<AgentResolveApprovalResult> => {
      const method = request.decision === "approve"
        ? "agent.approval.approve_and_resume_tool"
        : "agent.approval.deny_and_resume_tool";
      return requestRuntime<AgentResolveApprovalResult>(method, request);
    }
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmList,
    async (_event, request: AgentVmListRequest = {}): Promise<AgentVmListResult> =>
      requestRuntime<AgentVmListResult>("agent.vm.list", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmListImages,
    async (_event, request: AgentVmImageListRequest = {}): Promise<AgentVmImageListResult> =>
      requestRuntime<AgentVmImageListResult>("agent.vm.images.list", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmDownloadImage,
    async (
      _event,
      request: AgentVmImageDownloadRequest
    ): Promise<AgentVmImageDownloadResult> =>
      requestRuntime<AgentVmImageDownloadResult>("agent.vm.image.download", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmImportImage,
    async (_event, request: AgentVmImageImportRequest): Promise<AgentVmImageImportResult> =>
      requestRuntime<AgentVmImageImportResult>("agent.vm.image.import", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmCreate,
    async (_event, request: AgentVmCreateRequest): Promise<AgentVmCreateResult> =>
      requestRuntime<AgentVmCreateResult>("agent.vm.create", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmListBindings,
    async (_event, request: AgentVmBindingListRequest = {}): Promise<AgentVmBindingListResult> =>
      requestRuntime<AgentVmBindingListResult>("agent.vm.bindings.list", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmReadBinding,
    async (_event, request: AgentVmReadBindingRequest): Promise<AgentVmBindingResult> =>
      requestRuntime<AgentVmBindingResult>("agent.vm.binding.read", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmAttach,
    async (_event, request: AgentVmAttachRequest): Promise<AgentVmBindingResult> =>
      requestRuntime<AgentVmBindingResult>("agent.vm.attach", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmTakeover,
    async (_event, request: AgentVmTakeoverRequest): Promise<AgentVmBindingResult> =>
      requestRuntime<AgentVmBindingResult>("agent.vm.takeover", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmFork,
    async (_event, request: AgentVmForkRequest): Promise<AgentVmBindingResult> =>
      requestRuntime<AgentVmBindingResult>("agent.vm.fork", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmCreateInheritanceProfile,
    async (
      _event,
      request: AgentVmCreateInheritanceProfileRequest
    ): Promise<AgentVmInheritanceProfileResult> =>
      requestRuntime<AgentVmInheritanceProfileResult>("agent.vm.inheritance.create", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmApplyInheritanceProfile,
    async (
      _event,
      request: AgentVmApplyInheritanceProfileRequest
    ): Promise<AgentVmApplyInheritanceProfileResult> =>
      requestRuntime<AgentVmApplyInheritanceProfileResult>("agent.vm.inheritance.apply", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmRevokeBinding,
    async (_event, request: AgentVmRevokeBindingRequest): Promise<AgentVmBindingResult> =>
      requestRuntime<AgentVmBindingResult>("agent.vm.binding.revoke", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmStatus,
    async (_event, request: AgentVmStatusRequest): Promise<AgentVmLifecycleResult> =>
      requestRuntime<AgentVmLifecycleResult>("agent.vm.status", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmStart,
    async (_event, request: AgentVmStatusRequest): Promise<AgentVmLifecycleResult> =>
      requestRuntime<AgentVmLifecycleResult>("agent.vm.start", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmStop,
    async (_event, request: AgentVmStatusRequest): Promise<AgentVmLifecycleResult> =>
      requestRuntime<AgentVmLifecycleResult>("agent.vm.stop", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmPasswordMetadata,
    async (
      _event,
      request: AgentVmPasswordMetadataRequest
    ): Promise<AgentVmPasswordMetadataResult> =>
      requestRuntime<AgentVmPasswordMetadataResult>("agent.vm.password.metadata", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmPasswordReveal,
    async (
      _event,
      request: AgentVmPasswordRevealRequest
    ): Promise<AgentVmPasswordRevealResult> =>
      requestRuntime<AgentVmPasswordRevealResult>("agent.vm.password.reveal", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiAgentVmConsoleConnect,
    async (_event, request: AgentVmConsoleConnectRequest): Promise<AgentVmConsoleConnectResult> => {
      const status = await requestRuntime<AgentVmStatusPayload>("agent.vm.status", {
        vmId: request.vmId
      });
      const vncPort = resolveRunningVncPort(status);
      return consoleBridge.open({
        vmId: request.vmId,
        vncPort
      });
    }
  );

  return {
    dispose: () => {
      unsubscribeRuntimeEvents();
      consoleBridge.dispose();
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadConfig);
      ipcMain.removeHandler(LYRA_CHANNELS.aiUpsertProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiDeleteProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiDiscoverModels);
      ipcMain.removeHandler(LYRA_CHANNELS.aiListSessions);
      ipcMain.removeHandler(LYRA_CHANNELS.aiCreateSession);
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadSession);
      ipcMain.removeHandler(LYRA_CHANNELS.aiUpdateSession);
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadFollow);
      ipcMain.removeHandler(LYRA_CHANNELS.aiPauseFollow);
      ipcMain.removeHandler(LYRA_CHANNELS.aiResumeFollow);
      ipcMain.removeHandler(LYRA_CHANNELS.aiPreviewMessageRollback);
      ipcMain.removeHandler(LYRA_CHANNELS.aiExecuteMessageRollback);
      ipcMain.removeHandler(LYRA_CHANNELS.aiSendTurn);
      ipcMain.removeHandler(LYRA_CHANNELS.aiCancelTurn);
      ipcMain.removeHandler(LYRA_CHANNELS.aiCreateTodo);
      ipcMain.removeHandler(LYRA_CHANNELS.aiCreatePlan);
      ipcMain.removeHandler(LYRA_CHANNELS.aiResolvePlanReview);
      ipcMain.removeHandler(LYRA_CHANNELS.aiResolveClarification);
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadArtifact);
      ipcMain.removeHandler(LYRA_CHANNELS.aiApplyPatch);
      ipcMain.removeHandler(LYRA_CHANNELS.aiResolveApproval);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmList);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmListImages);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmDownloadImage);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmImportImage);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmCreate);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmListBindings);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmReadBinding);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmAttach);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmTakeover);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmFork);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmCreateInheritanceProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmApplyInheritanceProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmRevokeBinding);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmStatus);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmStart);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmStop);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmPasswordMetadata);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmPasswordReveal);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAgentVmConsoleConnect);
    }
  };
};
