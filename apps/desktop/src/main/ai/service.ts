import { ipcMain } from "electron";

import {
  LYRA_CHANNELS,
  type AgentCancelTurnRequest,
  type AgentCancelTurnResult,
  type AgentApplyPatchRequest,
  type AgentApplyPatchResult,
  type AgentArtifactContent,
  type AgentCreatePlanRequest,
  type AgentCreatePlanResult,
  type AgentCreateSessionRequest,
  type AgentCreateTodoRequest,
  type AgentCreateTodoResult,
  type AgentReadArtifactRequest,
  type AgentReadSessionRequest,
  type AgentResolveApprovalRequest,
  type AgentResolveApprovalResult,
  type AgentResolvePlanReviewRequest,
  type AgentResolvePlanReviewResult,
  type AgentRuntimeStreamEvent,
  type AgentSendTurnRequest,
  type AgentSendTurnResult,
  type AgentSession,
  type AgentSessionDetail,
  type AgentUpdateSessionRequest,
  type AiDeleteProfileRequest,
  type AiDiscoverModelsRequest,
  type AiModelDiscoveryResult,
  type AiProviderProfile,
  type AiRuntimeConfigSnapshot,
  type AiUpsertProfileRequest
} from "../../shared/desktop-bridge";
import type { LyraRuntimeClient } from "../runtime-client";

type AiBridgeOptions = {
  readonly runtimeClient: LyraRuntimeClient;
  readonly storageRoot: string;
  readonly getWindow?: () => Electron.BrowserWindow | null;
};

const AI_RUNTIME_EVENT_NAME = "agent.runtime";

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
    async (_event, request: AgentResolveApprovalRequest): Promise<AgentResolveApprovalResult> =>
      requestRuntime<AgentResolveApprovalResult>("agent.approval.resolve", request)
  );

  return {
    dispose: () => {
      unsubscribeRuntimeEvents();
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadConfig);
      ipcMain.removeHandler(LYRA_CHANNELS.aiUpsertProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiDeleteProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiDiscoverModels);
      ipcMain.removeHandler(LYRA_CHANNELS.aiListSessions);
      ipcMain.removeHandler(LYRA_CHANNELS.aiCreateSession);
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadSession);
      ipcMain.removeHandler(LYRA_CHANNELS.aiUpdateSession);
      ipcMain.removeHandler(LYRA_CHANNELS.aiSendTurn);
      ipcMain.removeHandler(LYRA_CHANNELS.aiCancelTurn);
      ipcMain.removeHandler(LYRA_CHANNELS.aiCreateTodo);
      ipcMain.removeHandler(LYRA_CHANNELS.aiCreatePlan);
      ipcMain.removeHandler(LYRA_CHANNELS.aiResolvePlanReview);
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadArtifact);
      ipcMain.removeHandler(LYRA_CHANNELS.aiApplyPatch);
      ipcMain.removeHandler(LYRA_CHANNELS.aiResolveApproval);
    }
  };
};
