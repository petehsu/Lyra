import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { LYRA_CHANNELS } from "../../shared/desktop-bridge";
import type {
  LyraSensitiveValueStoreRequest,
  LyraSensitiveValueStoreResponse
} from "../../shared/desktop-bridge";
import {
  readConsent,
  writeConsent,
  readStatus,
} from "../persona/consent-service";
import type {
  AgentClarificationRespondRequest,
  AgentGitDiffRequest,
  AgentGitDiffResponse,
  AgentGitFileRequest,
  AgentGitMutationResponse,
  AgentGitStatusRequest,
  AgentGitStatusSnapshot,
  AgentImageAttachmentMaterializeRequest,
  AgentMemoryAuditResponse,
  AgentMemorySharedSearchRequest,
  AgentMemorySharedUpdateRequest,
  AgentMemorySnapshot,
  AgentPermissionPolicySetModeRequest,
  AgentPermissionPolicySnapshot,
  AgentPermissionRespondRequest,
  AgentPlanReviseRequest,
  AgentProjectPlanDeleteRequest,
  AgentProjectPlanDeleteResponse,
  AgentProjectPlanListRequest,
  AgentProjectPlanListResponse,
  AgentProjectPlanReadRequest,
  AgentProjectPlanReadResponse,
  AgentProjectTodoReadRequest,
  AgentProjectTodoReadResponse,
  AgentPlanReviewRespondRequest,
  AgentMessageResolveRequest,
  AgentMessageResolveResponse,
  AgentRollbackPreviewResponse,
  AgentRollbackRequest,
  AgentRollbackRestoreResponse,
  AgentSessionArchiveRequest,
  AgentSessionBindProjectRequest,
  AgentSessionCreateRequest,
  AgentTemporarySessionCreateRequest,
  AgentSessionDeleteRequest,
  AgentSessionDeleteResponse,
  AgentSessionReadRequest,
  AgentSessionRenameRequest,
  AgentSessionSaveRequest,
  AgentSessionSnapshot,
  AgentTurnCancelRequest,
  AgentTurnCancelResponse,
  AgentTurnSendRequest,
  AgentTurnSendResponse,
  AgentBrowserFollowModeSnapshot,
  AgentBrowserFollowModeUpdateRequest,
  AgentActCacheSnapshot,
  AgentActCacheUpdateRequest,
  AgentCodeGraphEmbeddingSnapshot,
  AgentCodeGraphEmbeddingUpdateRequest,
  AgentActionRunRequest,
  AgentAccountLoginCompleteRequest,
  AgentAccountLoginCompleteResponse,
  AgentAccountLoginRequest,
  AgentAccountLoginStartRequest,
  AgentAccountLoginStartResponse,
  AgentAccountRequest,
  AgentAccountsSnapshot,
  AgentFeedbackRunRequest,
  AgentCodegraphStatus,
  AgentConfigSnapshot,
  AgentProviderCatalogSnapshot,
  AgentConfigUpdateRequest,
  AgentLoginProviderCatalogSnapshot,
  AgentModelDeleteRequest,
  AgentModelEnableRequest,
  AgentModelRefreshRequest,
  AgentModelCatalogRequest,
  AgentModelCatalogSnapshot,
  AgentModelSwitchRequest,
  AgentMcpListResponse,
  AgentMcpServerMutationResponse,
  AgentMcpServerRemoveResponse,
  AgentMcpServerRequest,
  AgentMcpServerUpsertRequest,
  AgentMcpToolDiscoverRequest,
  AgentMcpToolDiscoverResponse,
  AgentProviderOptionsUpdateRequest,
  AgentProviderProfileSaveRequest,
  AgentPokeRequest,
  AgentPokeResponse,
  AgentSessionSummary,
  AgentSessionListRequest,
  AgentSessionListResponse,
  AgentProtocolContract,
  AgentSkillActivationRequest,
  AgentSkillInspectRequest,
  AgentSkillInspectResponse,
  AgentSkillInstallFromGitRequest,
  AgentSkillInstallFromLocalRequest,
  AgentSkillInstallFromStoreRequest,
  AgentSkillMutationResponse,
  AgentSkillRefreshStoreRequest,
  AgentSkillsListResponse,
  AgentSkillStoreResponse,
  AgentSkillUninstallRequest,
  AgentSkillUninstallResponse
} from "../../shared/agent";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import { materializeImageAttachment } from "./artifact-materializer";
import { normalizePayload } from "./host-payload";
import { actCacheController } from "./act-cache-toggle";
import { codeGraphEmbeddingController } from "./codegraph-embedding-toggle";

type RequestRuntime = <T>(method: string, payload?: object) => Promise<T>;

export type AgentBrowserFollowModeController = {
  readonly read: () => boolean;
  readonly set: (enabled: boolean) => void;
};

export const createAgentIpcRouter = ({
  requestRuntime,
  storageRoot,
  browserFollowMode,
  getBrowserBridge,
  addAllowedPreviewRoot,
  storeSensitiveValue,
  closePrivateTerminalsForSession,
  listPrivateTerminalsForSession,
  closePrivateTerminalSession
}: {
  readonly requestRuntime: RequestRuntime;
  readonly storageRoot: string;
  readonly browserFollowMode: AgentBrowserFollowModeController;
  readonly getBrowserBridge: () => WorkbenchBrowserIpcBridge | null;
  readonly addAllowedPreviewRoot?: (rootPath: string) => void;
  readonly storeSensitiveValue?: (
    request: LyraSensitiveValueStoreRequest
  ) => Promise<LyraSensitiveValueStoreResponse>;
  readonly closePrivateTerminalsForSession: (agentSessionId: string) => Promise<void>;
  readonly listPrivateTerminalsForSession: (agentSessionId: string) => readonly {
    readonly sessionId: string;
    readonly title: string;
    readonly cwd?: string;
    readonly mode: "shell" | "command";
    readonly command?: string;
    readonly createdAt: string;
  }[];
  readonly closePrivateTerminalSession: (agentSessionId: string, terminalSessionId: string) => Promise<void>;
}): { readonly dispose: () => void } => {
  const secureProviderApiKey = async <
    T extends AgentProviderProfileSaveRequest | AgentAccountLoginCompleteRequest
  >(request: T): Promise<T> => {
    const apiKey = request.apiKey?.trim() ?? "";
    if (apiKey.length === 0 || storeSensitiveValue === undefined) {
      return request;
    }
    const providerId = request.profileName?.trim()
      || ("provider" in request ? request.provider : request.routeId);
    const stored = await storeSensitiveValue({
      owner: "ai-provider",
      valueKind: "api_key",
      label: `API key for ${providerId}`,
      description: `Stored API key for Lyra provider ${providerId}`,
      value: apiKey,
      capabilities: ["list_metadata", "use"]
    });
    const { apiKey: _apiKey, ...rest } = request;
    return {
      ...rest,
      apiKeyRef: stored.ref
    } as T;
  };

  const handlers: Array<readonly [string, (_event: IpcMainInvokeEvent, payload?: unknown) => unknown]> = [
    [
      LYRA_CHANNELS.agentSessionCreate,
      (_event, payload) =>
        requestRuntime<AgentSessionSnapshot>(
          "agent.session.create",
          (payload as AgentSessionCreateRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSessionCreateTemporary,
      (_event, payload) =>
        requestRuntime<AgentSessionSnapshot>(
          "agent.session.createTemporary",
          payload as AgentTemporarySessionCreateRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSessionRead,
      (_event, payload) =>
        requestRuntime<AgentSessionSnapshot>(
          "agent.session.read",
          (payload as AgentSessionReadRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSessionList,
      (_event, payload) =>
        requestRuntime<AgentSessionListResponse>(
          "agent.session.list",
          (payload as AgentSessionListRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSessionSave,
      (_event, payload) =>
        requestRuntime<AgentSessionSummary>(
          "agent.session.save",
          payload as AgentSessionSaveRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSessionUnsave,
      (_event, payload) =>
        requestRuntime<AgentSessionSummary>(
          "agent.session.unsave",
          payload as AgentSessionDeleteRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSessionRename,
      (_event, payload) =>
        requestRuntime<AgentSessionSummary>(
          "agent.session.rename",
          payload as AgentSessionRenameRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSessionArchive,
      (_event, payload) =>
        requestRuntime<AgentSessionSummary>(
          "agent.session.archive",
          payload as AgentSessionArchiveRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSessionDelete,
      async (_event, payload) => {
        const request = payload as AgentSessionDeleteRequest;
        const response = await requestRuntime<AgentSessionDeleteResponse>(
          "agent.session.delete",
          request
        );
        await closePrivateTerminalsForSession(request.sessionId);
        return response;
      }
    ],
    [
      LYRA_CHANNELS.agentSessionBindProject,
      async (_event, payload) => {
        const snapshot = await requestRuntime<AgentSessionSnapshot>(
          "agent.session.bindProject",
          payload as AgentSessionBindProjectRequest
        );
        if (
          snapshot.workingDirIsHome !== true &&
          typeof snapshot.workingDir === "string" &&
          snapshot.workingDir.trim().length > 0
        ) {
          addAllowedPreviewRoot?.(snapshot.workingDir);
        }
        return snapshot;
      }
    ],
    [
      LYRA_CHANNELS.agentCodegraphStatus,
      (_event, payload) =>
        requestRuntime<AgentCodegraphStatus>(
          "agent.codegraph.status",
          payload as { sessionId?: string; workingDir?: string }
        )
    ],
    [
      LYRA_CHANNELS.agentTerminalListPrivate,
      (_event, payload) => {
        const request = payload as { sessionId: string };
        return listPrivateTerminalsForSession(request.sessionId);
      }
    ],
    [
      LYRA_CHANNELS.agentTerminalClosePrivate,
      async (_event, payload) => {
        const request = payload as { sessionId: string; terminalSessionId: string };
        await closePrivateTerminalSession(request.sessionId, request.terminalSessionId);
      }
    ],
    [
      LYRA_CHANNELS.agentImageAttachmentMaterialize,
      (_event, payload) =>
        materializeImageAttachment(
          storageRoot,
          payload as AgentImageAttachmentMaterializeRequest
        )
    ],
    [
      LYRA_CHANNELS.agentBrowserFollowRead,
      () => ({
        enabled: browserFollowMode.read()
      } satisfies AgentBrowserFollowModeSnapshot)
    ],
    [
      LYRA_CHANNELS.agentBrowserFollowUpdate,
      (_event, payload) => {
        const request = normalizePayload(payload) as AgentBrowserFollowModeUpdateRequest;
        browserFollowMode.set(request.enabled === true);
        if (!browserFollowMode.read()) {
          getBrowserBridge()?.finishAgentFollowSessions({
            status: "cancelled",
            reason: "follow_disabled"
          });
        }
        return {
          enabled: browserFollowMode.read()
        } satisfies AgentBrowserFollowModeSnapshot;
      }
    ],
    [
      LYRA_CHANNELS.agentActCacheRead,
      () => ({
        enabled: actCacheController.read()
      } satisfies AgentActCacheSnapshot)
    ],
    [
      LYRA_CHANNELS.agentActCacheUpdate,
      (_event, payload) => {
        const request = normalizePayload(payload) as AgentActCacheUpdateRequest;
        actCacheController.set(request.enabled === true);
        return {
          enabled: actCacheController.read()
        } satisfies AgentActCacheSnapshot;
      }
    ],
    [
      LYRA_CHANNELS.agentCodeGraphEmbeddingRead,
      () => ({
        enabled: codeGraphEmbeddingController.read()
      } satisfies AgentCodeGraphEmbeddingSnapshot)
    ],
    [
      LYRA_CHANNELS.agentCodeGraphEmbeddingUpdate,
      (_event, payload) => {
        const request = normalizePayload(payload) as AgentCodeGraphEmbeddingUpdateRequest;
        codeGraphEmbeddingController.set(request.enabled === true);
        return {
          enabled: codeGraphEmbeddingController.read()
        } satisfies AgentCodeGraphEmbeddingSnapshot;
      }
    ],
    [
      LYRA_CHANNELS.agentTurnStart,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.turn.start",
          payload as AgentTurnSendRequest
        )
    ],
    [
      LYRA_CHANNELS.agentTurnSend,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.turn.send",
          payload as AgentTurnSendRequest
        )
    ],
    [
      LYRA_CHANNELS.agentTurnResume,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.turn.resume",
          payload as AgentTurnSendRequest
        )
    ],
    [
      LYRA_CHANNELS.agentTurnCancel,
      (_event, payload) =>
        requestRuntime<AgentTurnCancelResponse>(
          "agent.turn.cancel",
          payload as AgentTurnCancelRequest
        )
    ],
    [
      LYRA_CHANNELS.agentMemorySnapshot,
      (_event, payload) =>
        requestRuntime<AgentMemorySnapshot>(
          "agent.memory.snapshot",
          (payload as AgentSessionReadRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentMemoryAudit,
      (_event, payload) =>
        requestRuntime<AgentMemoryAuditResponse>(
          "agent.memory.audit",
          (payload as AgentSessionReadRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentMemoryRecoverRun,
      (_event, payload) =>
        requestRuntime<unknown>(
          "agent.memory.recover.run",
          (payload as AgentSessionReadRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentMemorySharedSearch,
      (_event, payload) =>
        requestRuntime<{ readonly records: readonly unknown[] }>(
          "agent.memory.shared.search",
          (payload as AgentMemorySharedSearchRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentMemorySharedUpdate,
      (_event, payload) =>
        requestRuntime<unknown>(
          "agent.memory.shared.update",
          payload as AgentMemorySharedUpdateRequest
        )
    ],
    [
      LYRA_CHANNELS.agentRollbackPreview,
      (_event, payload) =>
        requestRuntime<AgentRollbackPreviewResponse>(
          "agent.rollback.preview",
          payload as AgentRollbackRequest
        )
    ],
    [
      LYRA_CHANNELS.agentRollbackRestore,
      (_event, payload) =>
        requestRuntime<AgentRollbackRestoreResponse>(
          "agent.rollback.restore",
          payload as AgentRollbackRequest
        )
    ],
    [
      LYRA_CHANNELS.agentMessageResolve,
      (_event, payload) =>
        requestRuntime<AgentMessageResolveResponse>(
          "agent.message.resolve",
          payload as AgentMessageResolveRequest
        )
    ],
    [
      LYRA_CHANNELS.agentGitStatus,
      (_event, payload) =>
        requestRuntime<AgentGitStatusSnapshot>(
          "agent.git.status",
          payload as AgentGitStatusRequest
        )
    ],
    [
      LYRA_CHANNELS.agentGitDiff,
      (_event, payload) =>
        requestRuntime<AgentGitDiffResponse>(
          "agent.git.diff",
          payload as AgentGitDiffRequest
        )
    ],
    [
      LYRA_CHANNELS.agentGitStage,
      (_event, payload) =>
        requestRuntime<AgentGitMutationResponse>(
          "agent.git.stage",
          payload as AgentGitFileRequest
        )
    ],
    [
      LYRA_CHANNELS.agentGitUnstage,
      (_event, payload) =>
        requestRuntime<AgentGitMutationResponse>(
          "agent.git.unstage",
          payload as AgentGitFileRequest
        )
    ],
    [
      LYRA_CHANNELS.agentGitDiscard,
      (_event, payload) =>
        requestRuntime<AgentGitMutationResponse>(
          "agent.git.discard",
          payload as AgentGitFileRequest
        )
    ],
    [
      LYRA_CHANNELS.agentPlanList,
      (_event, payload) =>
        requestRuntime<AgentProjectPlanListResponse>(
          "agent.plan.list",
          (payload as AgentProjectPlanListRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentPlanRead,
      (_event, payload) =>
        requestRuntime<AgentProjectPlanReadResponse>(
          "agent.plan.read",
          payload as AgentProjectPlanReadRequest
        )
    ],
    [
      LYRA_CHANNELS.agentPlanDelete,
      (_event, payload) =>
        requestRuntime<AgentProjectPlanDeleteResponse>(
          "agent.plan.delete",
          payload as AgentProjectPlanDeleteRequest
        )
    ],
    [
      LYRA_CHANNELS.agentPlanRevise,
      (_event, payload) =>
        requestRuntime<AgentSessionSnapshot>(
          "agent.plan.revise",
          payload as AgentPlanReviseRequest
        )
    ],
    [
      LYRA_CHANNELS.agentPlanReviewRespond,
      (_event, payload) =>
        requestRuntime<AgentSessionSnapshot>(
          "agent.plan.review.respond",
          payload as AgentPlanReviewRespondRequest
        )
    ],
    [
      LYRA_CHANNELS.agentTodoReadProject,
      (_event, payload) =>
        requestRuntime<AgentProjectTodoReadResponse>(
          "agent.todo.read-project",
          payload as AgentProjectTodoReadRequest
        )
    ],
    [
      LYRA_CHANNELS.agentClarificationRespond,
      (_event, payload) =>
        requestRuntime<unknown>(
          "agent.clarification.respond",
          payload as AgentClarificationRespondRequest
        )
    ],
    [
      LYRA_CHANNELS.agentPermissionRespond,
      (_event, payload) =>
        requestRuntime<unknown>(
          "agent.permission.respond",
          payload as AgentPermissionRespondRequest
        )
    ],
    [
      LYRA_CHANNELS.agentPermissionPolicyRead,
      () => requestRuntime<AgentPermissionPolicySnapshot>("agent.permissionPolicy.read")
    ],
    [
      LYRA_CHANNELS.agentPermissionPolicySetMode,
      (_event, payload) =>
        requestRuntime<AgentPermissionPolicySnapshot>(
          "agent.permissionPolicy.setMode",
          (payload as AgentPermissionPolicySetModeRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentConfigRead,
      () => requestRuntime<AgentConfigSnapshot>("agent.config.read")
    ],
    [
      LYRA_CHANNELS.agentProviderCatalogRead,
      () =>
        requestRuntime<AgentProviderCatalogSnapshot>(
          "agent.provider.catalog.read",
          {}
        )
    ],
    [
      LYRA_CHANNELS.agentConfigUpdate,
      (_event, payload) =>
        requestRuntime<AgentConfigSnapshot>(
          "agent.config.update",
          (payload as AgentConfigUpdateRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentProviderProfileSave,
      async (_event, payload) =>
        requestRuntime<AgentConfigSnapshot>(
          "agent.provider.profile.save",
          await secureProviderApiKey(payload as AgentProviderProfileSaveRequest)
        )
    ],
    [
      LYRA_CHANNELS.agentModelsList,
      (_event, payload) =>
        requestRuntime<AgentModelCatalogSnapshot>(
          "agent.models.list",
          (payload as AgentModelCatalogRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentModelSwitch,
      (_event, payload) =>
        requestRuntime<AgentModelCatalogSnapshot>(
          "agent.models.switch",
          payload as AgentModelSwitchRequest
        )
    ],
    [
      LYRA_CHANNELS.agentModelEnable,
      (_event, payload) =>
        requestRuntime<AgentModelCatalogSnapshot>(
          "agent.models.enable",
          payload as AgentModelEnableRequest
        )
    ],
    [
      LYRA_CHANNELS.agentModelDelete,
      (_event, payload) =>
        requestRuntime<AgentModelCatalogSnapshot>(
          "agent.models.delete",
          payload as AgentModelDeleteRequest
        )
    ],
    [
      LYRA_CHANNELS.agentModelRefresh,
      (_event, payload) =>
        requestRuntime<AgentModelCatalogSnapshot>(
          "agent.models.refresh",
          (payload as AgentModelRefreshRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentProviderOptionsUpdate,
      (_event, payload) =>
        requestRuntime<AgentModelCatalogSnapshot>(
          "agent.provider.options.update",
          payload as AgentProviderOptionsUpdateRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSkillsList,
      () => requestRuntime<AgentSkillsListResponse>("agent.skills.list")
    ],
    [
      LYRA_CHANNELS.agentSkillInspect,
      (_event, payload) =>
        requestRuntime<AgentSkillInspectResponse>(
          "agent.skills.inspect",
          payload as AgentSkillInspectRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSkillActivate,
      (_event, payload) =>
        requestRuntime<AgentSkillMutationResponse>(
          "agent.skills.activate",
          payload as AgentSkillActivationRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSkillDeactivate,
      (_event, payload) =>
        requestRuntime<AgentSkillMutationResponse>(
          "agent.skills.deactivate",
          payload as AgentSkillActivationRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSkillInstallFromLocal,
      (_event, payload) =>
        requestRuntime<AgentSkillMutationResponse>(
          "agent.skills.installFromLocal",
          payload as AgentSkillInstallFromLocalRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSkillInstallFromGit,
      (_event, payload) =>
        requestRuntime<AgentSkillMutationResponse>(
          "agent.skills.installFromGit",
          payload as AgentSkillInstallFromGitRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSkillInstallFromStore,
      (_event, payload) =>
        requestRuntime<AgentSkillMutationResponse>(
          "agent.skills.installFromStore",
          payload as AgentSkillInstallFromStoreRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSkillUninstall,
      (_event, payload) =>
        requestRuntime<AgentSkillUninstallResponse>(
          "agent.skills.uninstall",
          payload as AgentSkillUninstallRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSkillRefreshStore,
      (_event, payload) =>
        requestRuntime<AgentSkillStoreResponse>(
          "agent.skills.refreshStore",
          (payload as AgentSkillRefreshStoreRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSkillUpdateStoreConfig,
      (_event, payload) =>
        requestRuntime<AgentSkillStoreResponse>(
          "agent.skills.updateStoreConfig",
          (payload as AgentSkillRefreshStoreRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentMcpList,
      () => requestRuntime<AgentMcpListResponse>("agent.mcp.list")
    ],
    [
      LYRA_CHANNELS.agentMcpUpsert,
      (_event, payload) =>
        requestRuntime<AgentMcpServerMutationResponse>(
          "agent.mcp.upsert",
          payload as AgentMcpServerUpsertRequest
        )
    ],
    [
      LYRA_CHANNELS.agentMcpRemove,
      (_event, payload) =>
        requestRuntime<AgentMcpServerRemoveResponse>(
          "agent.mcp.remove",
          payload as AgentMcpServerRequest
        )
    ],
    [
      LYRA_CHANNELS.agentMcpConnect,
      (_event, payload) =>
        requestRuntime<AgentMcpServerMutationResponse>(
          "agent.mcp.connect",
          payload as AgentMcpServerRequest
        )
    ],
    [
      LYRA_CHANNELS.agentMcpDisconnect,
      (_event, payload) =>
        requestRuntime<AgentMcpServerMutationResponse>(
          "agent.mcp.disconnect",
          payload as AgentMcpServerRequest
        )
    ],
    [
      LYRA_CHANNELS.agentMcpReload,
      (_event, payload) =>
        requestRuntime<AgentMcpServerMutationResponse>(
          "agent.mcp.reload",
          payload as AgentMcpServerRequest
        )
    ],
    [
      LYRA_CHANNELS.agentMcpDiscoverTools,
      (_event, payload) =>
        requestRuntime<AgentMcpToolDiscoverResponse>(
          "agent.mcp.discoverTools",
          (payload as AgentMcpToolDiscoverRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentImproveRun,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.action.improve",
          (payload as AgentActionRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentRefactorRun,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.action.refactor",
          (payload as AgentActionRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentPokeTrigger,
      (_event, payload) =>
        requestRuntime<AgentPokeResponse>(
          "agent.action.poke",
          (payload as AgentPokeRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentReviewRun,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.action.review",
          (payload as AgentFeedbackRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentJudgeRun,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.action.judge",
          (payload as AgentFeedbackRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentAccountsList,
      () => requestRuntime<AgentAccountsSnapshot>("agent.accounts.list")
    ],
    [
      LYRA_CHANNELS.agentAccountsLogin,
      (_event, payload) =>
        requestRuntime<AgentAccountsSnapshot>(
          "agent.accounts.login",
          payload as AgentAccountLoginRequest
        )
    ],
    [
      LYRA_CHANNELS.agentAccountsLoginProviders,
      () => requestRuntime<AgentLoginProviderCatalogSnapshot>("agent.accounts.loginProviders")
    ],
    [
      LYRA_CHANNELS.agentAccountsLoginStart,
      (_event, payload) =>
        requestRuntime<AgentAccountLoginStartResponse>(
          "agent.accounts.loginStart",
          payload as AgentAccountLoginStartRequest
        )
    ],
    [
      LYRA_CHANNELS.agentAccountsLoginComplete,
      async (_event, payload) =>
        requestRuntime<AgentAccountLoginCompleteResponse>(
          "agent.accounts.loginComplete",
          await secureProviderApiKey(payload as AgentAccountLoginCompleteRequest)
        )
    ],
    [
      LYRA_CHANNELS.agentAccountsSwitch,
      (_event, payload) =>
        requestRuntime<AgentAccountsSnapshot>(
          "agent.accounts.switch",
          payload as AgentAccountRequest
        )
    ],
    [
      LYRA_CHANNELS.agentAccountsRemove,
      (_event, payload) =>
        requestRuntime<AgentAccountsSnapshot>(
          "agent.accounts.remove",
          payload as AgentAccountRequest
        )
    ],
    [
      LYRA_CHANNELS.agentProtocolContract,
      () =>
        requestRuntime<AgentProtocolContract>("agent.protocol.contract")
    ],
    [
      LYRA_CHANNELS.personaConsentRead,
      () => readConsent()
    ],
    [
      LYRA_CHANNELS.personaConsentWrite,
      (_event, payload) => writeConsent(payload)
    ],
    [
      LYRA_CHANNELS.personaStatus,
      () => readStatus()
    ],
    [
      LYRA_CHANNELS.personaRefresh,
      () => {
        // Refresh signal: desktop just confirms the request.
        // The actual OSINT rescan happens on the next agent turn
        // when runtime detects consent=true and cached persona is stale.
        return { triggered: true };
      }
    ],
  ];

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, handler);
  }

  return {
    dispose: () => {
      for (const [channel] of handlers) {
        ipcMain.removeHandler(channel);
      }
    }
  };
};
