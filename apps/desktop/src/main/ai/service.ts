import { BrowserWindow, ipcMain, shell } from "electron";

import {
  LYRA_CHANNELS,
  type AiMemoryConfig,
  type AgentAnswerQuestionRequest,
  type AgentAnswerPlanQuestionRequest,
  type AgentBindSessionProjectRequest,
  type AgentEnterPlanModeRequest,
  type AgentCreateSessionRequest,
  type AgentDeleteSessionRequest,
  type AgentGetPendingInteractionsRequest,
  type AgentGetPlanRequest,
  type AgentGetSessionRequest,
  type AgentPendingInteraction,
  type AgentPlanState,
  type AgentResolvePlanApprovalRequest,
  type AgentRuntimeEvent,
  type AgentSendTurnRequest,
  type AgentSendTurnResult,
  type AgentSession,
  type AgentSessionDetail,
  type CommandApprovalSubmitRequest,
  type AiDeleteProfileRequest,
  type AiDiscoverModelsRequest,
  type AiModelDiscoveryResult,
  type AiProfileValidationResult,
  type AiProviderCatalogItem,
  type AiProviderPreset,
  type AiProviderProfile,
  type AiSetDefaultProfileRequest,
  type AiUpsertProfileRequest,
  type AiValidateProfileRequest
} from "../../shared/desktop-bridge";
import {
  authorizeOpenAiChatGptInBrowser,
  authorizeOpenAiChatGptViaDeviceCode
} from "./openai-auth";
import type { LyraRuntimeClient } from "../runtime-client";
import type {
  AiIpcBridge,
  NativeAgentAnswerQuestionRequest,
  NativeAgentCreateSessionRequest,
  NativeAgentDeleteSessionRequest,
  NativeAgentBindSessionProjectRequest,
  NativeAgentAnswerPlanQuestionRequest,
  NativeAgentGetSessionRequest,
  NativeAgentEnterPlanModeRequest,
  NativeAgentGetPendingInteractionsRequest,
  NativeAgentGetPlanRequest,
  NativeAgentListSessionsRequest,
  NativeAgentMemoryConfigRequest,
  NativeAgentResolvePlanApprovalRequest,
  NativeAgentSendTurnRequest,
  NativeAgentUpdateMemoryConfigRequest,
  NativeCommandApprovalSubmitRequest,
  NativeAiDeleteProfileRequest,
  NativeAiDiscoverModelsRequest,
  NativeAiReadPresetCatalogRequest,
  NativeAiReadProfilesRequest,
  NativeAiReadProviderCatalogRequest,
  NativeAiSetDefaultProfileRequest,
  NativeAiUpsertProfileRequest,
  NativeAiValidateProfileRequest
} from "./types";

export const createAiIpcBridge = (
  storageRoot: string,
  runtimeClient: LyraRuntimeClient
): AiIpcBridge => {
  const requestRuntime = async <T>(method: string, payload: unknown): Promise<T> =>
    await runtimeClient.request<T>(method, payload);

  ipcMain.handle(LYRA_CHANNELS.aiReadProfiles, async () =>
    await requestRuntime<readonly AiProviderProfile[]>("profiles.read", {
      storageRoot
    } satisfies NativeAiReadProfilesRequest)
  );

  ipcMain.handle(LYRA_CHANNELS.aiReadProviderCatalog, async () =>
    await requestRuntime<readonly AiProviderCatalogItem[]>("providers.catalog.read", {
      storageRoot
    } satisfies NativeAiReadProviderCatalogRequest)
  );

  ipcMain.handle(LYRA_CHANNELS.aiReadPresetCatalog, async () =>
    await requestRuntime<readonly AiProviderPreset[]>("providers.presets.read", {
      storageRoot
    } satisfies NativeAiReadPresetCatalogRequest)
  );

  ipcMain.handle(LYRA_CHANNELS.aiAuthorizeOpenAiChatGpt, async () =>
    await authorizeOpenAiChatGptInBrowser(async (url) => {
      await shell.openExternal(url);
      return true;
    })
  );

  ipcMain.handle(LYRA_CHANNELS.aiAuthorizeOpenAiChatGptDeviceCode, async () =>
    await authorizeOpenAiChatGptViaDeviceCode(async (url) => {
      await shell.openExternal(url);
      return true;
    })
  );

  ipcMain.handle(
    LYRA_CHANNELS.aiUpsertProfile,
    async (_event, request: AiUpsertProfileRequest) =>
      await requestRuntime<AiProviderProfile>("profiles.upsert", {
        storageRoot,
        ...request
      } satisfies NativeAiUpsertProfileRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.aiDeleteProfile,
    async (_event, request: AiDeleteProfileRequest) => {
      await requestRuntime<null>("profiles.delete", {
        storageRoot,
        ...request
      } satisfies NativeAiDeleteProfileRequest);
    }
  );

  ipcMain.handle(
    LYRA_CHANNELS.aiSetDefaultProfile,
    async (_event, request: AiSetDefaultProfileRequest) =>
      await requestRuntime<AiProviderProfile>("profiles.set_default", {
        storageRoot,
        ...request
      } satisfies NativeAiSetDefaultProfileRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.aiValidateProfile,
    async (_event, request: AiValidateProfileRequest) =>
      await requestRuntime<AiProfileValidationResult>("profiles.validate", {
        storageRoot,
        ...request
      } satisfies NativeAiValidateProfileRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.aiDiscoverModels,
    async (_event, request: AiDiscoverModelsRequest) =>
      await requestRuntime<AiModelDiscoveryResult>("models.discover", {
        storageRoot,
        ...request
      } satisfies NativeAiDiscoverModelsRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.aiRefreshDiscoveredModels,
    async (_event, request: AiDiscoverModelsRequest) =>
      await requestRuntime<AiModelDiscoveryResult>("models.discover", {
        storageRoot,
        ...request,
        forceRefresh: true
      } satisfies NativeAiDiscoverModelsRequest)
  );

  ipcMain.handle(LYRA_CHANNELS.agentListSessions, async () =>
    await requestRuntime<readonly AgentSession[]>("agent.sessions.list", {
      storageRoot
    } satisfies NativeAgentListSessionsRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentCreateSession,
    async (_event, request?: AgentCreateSessionRequest) =>
      await requestRuntime<AgentSession>("agent.sessions.create", {
        storageRoot,
        ...(request ?? {})
      } satisfies NativeAgentCreateSessionRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentGetSession,
    async (_event, request: AgentGetSessionRequest) =>
      await requestRuntime<AgentSessionDetail>("agent.sessions.get", {
        storageRoot,
        ...request
      } satisfies NativeAgentGetSessionRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentBindSessionProject,
    async (_event, request: AgentBindSessionProjectRequest) =>
      await requestRuntime<AgentSession>("agent.sessions.bind_project", {
        storageRoot,
        ...request
      } satisfies NativeAgentBindSessionProjectRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentDeleteSession,
    async (_event, request: AgentDeleteSessionRequest) => {
      await requestRuntime<null>("agent.sessions.delete", {
        storageRoot,
        ...request
      } satisfies NativeAgentDeleteSessionRequest);
    }
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentSendTurn,
    async (_event, request: AgentSendTurnRequest) =>
      await requestRuntime<AgentSendTurnResult>("agent.turns.send", {
        storageRoot,
        ...request
      } satisfies NativeAgentSendTurnRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentEnterPlanMode,
    async (_event, request: AgentEnterPlanModeRequest) =>
      await requestRuntime<AgentSessionDetail>("agent.plan.enter", {
        storageRoot,
        ...request
      } satisfies NativeAgentEnterPlanModeRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentGetPlan,
    async (_event, request: AgentGetPlanRequest) =>
      await requestRuntime<AgentPlanState | null>("agent.plan.get", {
        storageRoot,
        ...request
      } satisfies NativeAgentGetPlanRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentGetPendingInteractions,
    async (_event, request: AgentGetPendingInteractionsRequest) =>
      await requestRuntime<readonly AgentPendingInteraction[]>("agent.interactions.get_pending", {
        storageRoot,
        ...request
      } satisfies NativeAgentGetPendingInteractionsRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentAnswerQuestion,
    async (_event, request: AgentAnswerQuestionRequest) => {
      await requestRuntime<void>("agent.questions.answer", {
        storageRoot,
        ...request
      } satisfies NativeAgentAnswerQuestionRequest);
    }
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentAnswerPlanQuestion,
    async (_event, request: AgentAnswerPlanQuestionRequest) => {
      await requestRuntime<void>("agent.plan.answer_question", {
        storageRoot,
        ...request
      } satisfies NativeAgentAnswerPlanQuestionRequest);
    }
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentResolvePlanApproval,
    async (_event, request: AgentResolvePlanApprovalRequest) =>
      await requestRuntime<AgentSendTurnResult | null>("agent.plan.resolve_approval", {
        storageRoot,
        ...request
      } satisfies NativeAgentResolvePlanApprovalRequest)
  );

  ipcMain.handle(LYRA_CHANNELS.agentGetMemoryConfig, async () =>
    await requestRuntime<AiMemoryConfig>("agent.memory.getConfig", {
      storageRoot
    } satisfies NativeAgentMemoryConfigRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentUpdateMemoryConfig,
    async (_event, config: AiMemoryConfig) =>
      await requestRuntime<AiMemoryConfig>("agent.memory.updateConfig", {
        storageRoot,
        config
      } satisfies NativeAgentUpdateMemoryConfigRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentSubmitCommandApproval,
    async (_event, request: CommandApprovalSubmitRequest) =>
      await requestRuntime<void>("agent.command_approval.submit", {
        storageRoot,
        ...request
      } satisfies NativeCommandApprovalSubmitRequest)
  );

  const unsubscribeRuntimeEvents = runtimeClient.subscribe((eventName, payload) => {
    if (eventName !== "agent.runtime") {
      return;
    }
    const event = payload as AgentRuntimeEvent;
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) {
        continue;
      }
      window.webContents.send(LYRA_CHANNELS.agentEvent, event);
    }
  });

  return {
    dispose: () => {
      unsubscribeRuntimeEvents();
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadProfiles);
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadProviderCatalog);
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadPresetCatalog);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAuthorizeOpenAiChatGpt);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAuthorizeOpenAiChatGptDeviceCode);
      ipcMain.removeHandler(LYRA_CHANNELS.aiUpsertProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiDeleteProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiSetDefaultProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiValidateProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiDiscoverModels);
      ipcMain.removeHandler(LYRA_CHANNELS.aiRefreshDiscoveredModels);
      ipcMain.removeHandler(LYRA_CHANNELS.agentListSessions);
      ipcMain.removeHandler(LYRA_CHANNELS.agentCreateSession);
      ipcMain.removeHandler(LYRA_CHANNELS.agentGetSession);
      ipcMain.removeHandler(LYRA_CHANNELS.agentBindSessionProject);
      ipcMain.removeHandler(LYRA_CHANNELS.agentDeleteSession);
      ipcMain.removeHandler(LYRA_CHANNELS.agentSendTurn);
      ipcMain.removeHandler(LYRA_CHANNELS.agentEnterPlanMode);
      ipcMain.removeHandler(LYRA_CHANNELS.agentGetPlan);
      ipcMain.removeHandler(LYRA_CHANNELS.agentAnswerPlanQuestion);
      ipcMain.removeHandler(LYRA_CHANNELS.agentResolvePlanApproval);
      ipcMain.removeHandler(LYRA_CHANNELS.agentGetMemoryConfig);
      ipcMain.removeHandler(LYRA_CHANNELS.agentUpdateMemoryConfig);
      ipcMain.removeHandler(LYRA_CHANNELS.agentSubmitCommandApproval);
    }
  };
};
