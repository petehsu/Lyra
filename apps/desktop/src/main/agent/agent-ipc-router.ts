import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { LYRA_CHANNELS } from "../../shared/desktop-bridge";
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
  AgentMemoryTrimRunRequest,
  AgentPermissionPolicySetModeRequest,
  AgentPermissionPolicySnapshot,
  AgentPermissionRespondRequest,
  AgentRollbackPreviewResponse,
  AgentRollbackRequest,
  AgentRollbackRestoreResponse,
  AgentSelfDevStartRequest,
  AgentSelfDevStartResponse,
  AgentSelfDevStatusRequest,
  AgentSelfDevStatusResponse,
  AgentSessionArchiveRequest,
  AgentSessionBindProjectRequest,
  AgentSessionCreateRequest,
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
  AgentActionRunRequest,
  AgentAccountLoginCompleteRequest,
  AgentAccountLoginCompleteResponse,
  AgentAccountLoginRequest,
  AgentAccountLoginStartRequest,
  AgentAccountLoginStartResponse,
  AgentAccountRequest,
  AgentAccountsSnapshot,
  AgentAutomationUpdateRequest,
  AgentAutomationUpdateResponse,
  AgentBtwRunRequest,
  AgentCompactResponse,
  AgentFeedbackRunRequest,
  AgentConfigSnapshot,
  AgentProviderCatalogSnapshot,
  AgentConfigUpdateRequest,
  AgentRolesUpdateRequest,
  AgentGoalsRequest,
  AgentGoalsResponse,
  AgentLoginProviderCatalogSnapshot,
  AgentModelRefreshRequest,
  AgentModelCatalogRequest,
  AgentModelCatalogSnapshot,
  AgentModelSwitchRequest,
  AgentOvernightListResponse,
  AgentOvernightRunRequest,
  AgentOvernightRunResponse,
  AgentOvernightStartRequest,
  AgentOvernightStartResponse,
  AgentProviderOptionsUpdateRequest,
  AgentProviderProfileSaveRequest,
  AgentPokeRequest,
  AgentPokeResponse,
  AgentSessionActionRequest,
  AgentSessionForkResponse,
  AgentSessionSummary,
  AgentSessionListRequest,
  AgentSessionListResponse,
  AgentSidePanelActionResponse,
  AgentSubagentRunRequest,
  AgentSubagentRunResponse
} from "../../shared/agent";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import { materializeImageAttachment } from "./artifact-materializer";
import { normalizePayload } from "./host-payload";

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
  closePrivateTerminalsForSession
}: {
  readonly requestRuntime: RequestRuntime;
  readonly storageRoot: string;
  readonly browserFollowMode: AgentBrowserFollowModeController;
  readonly getBrowserBridge: () => WorkbenchBrowserIpcBridge | null;
  readonly closePrivateTerminalsForSession: (agentSessionId: string) => Promise<void>;
}): { readonly dispose: () => void } => {
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
      (_event, payload) =>
        requestRuntime<AgentSessionSnapshot>(
          "agent.session.bindProject",
          payload as AgentSessionBindProjectRequest
        )
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
      LYRA_CHANNELS.agentSelfDevStart,
      (_event, payload) =>
        requestRuntime<AgentSelfDevStartResponse>(
          "agent.selfdev.start",
          (payload as AgentSelfDevStartRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSelfDevStatus,
      (_event, payload) =>
        requestRuntime<AgentSelfDevStatusResponse>(
          "agent.selfdev.status",
          (payload as AgentSelfDevStatusRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSelfDevSendTurn,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.selfdev.sendTurn",
          payload as AgentTurnSendRequest
        )
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
      LYRA_CHANNELS.agentTurnRetry,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.turn.retry",
          payload as AgentTurnSendRequest
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
      LYRA_CHANNELS.agentMemoryTrimRun,
      (_event, payload) =>
        requestRuntime<unknown>(
          "agent.memory.trim.run",
          (payload as AgentMemoryTrimRunRequest | undefined) ?? {}
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
      (_event, payload) =>
        requestRuntime<AgentConfigSnapshot>(
          "agent.provider.profile.save",
          payload as AgentProviderProfileSaveRequest
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
      LYRA_CHANNELS.agentRolesUpdate,
      (_event, payload) =>
        requestRuntime<AgentConfigSnapshot>(
          "agent.roles.update",
          payload as AgentRolesUpdateRequest
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
      LYRA_CHANNELS.agentSubagentRun,
      (_event, payload) =>
        requestRuntime<AgentSubagentRunResponse>(
          "agent.subagent.run",
          payload as AgentSubagentRunRequest
        )
    ],
    [
      LYRA_CHANNELS.agentBtwRun,
      (_event, payload) =>
        requestRuntime<AgentSidePanelActionResponse>(
          "agent.btw.run",
          payload as AgentBtwRunRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSessionSplit,
      (_event, payload) =>
        requestRuntime<AgentSessionForkResponse>(
          "agent.session.split",
          (payload as AgentSessionActionRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSessionTransfer,
      (_event, payload) =>
        requestRuntime<AgentSessionForkResponse>(
          "agent.session.transfer",
          (payload as AgentSessionActionRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSessionCompact,
      (_event, payload) =>
        requestRuntime<AgentCompactResponse>(
          "agent.session.compact",
          (payload as AgentSessionActionRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSessionAutomationUpdate,
      (_event, payload) =>
        requestRuntime<AgentAutomationUpdateResponse>(
          "agent.session.automation.update",
          payload as AgentAutomationUpdateRequest
        )
    ],
    [
      LYRA_CHANNELS.agentGoalsList,
      (_event, payload) =>
        requestRuntime<AgentGoalsResponse>(
          "agent.goals.list",
          (payload as AgentGoalsRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentGoalsOpen,
      (_event, payload) =>
        requestRuntime<AgentGoalsResponse>(
          "agent.goals.open",
          (payload as AgentGoalsRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentGoalsResume,
      (_event, payload) =>
        requestRuntime<AgentGoalsResponse>(
          "agent.goals.resume",
          (payload as AgentGoalsRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentGoalsShow,
      (_event, payload) =>
        requestRuntime<AgentGoalsResponse>(
          "agent.goals.show",
          payload as AgentGoalsRequest
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
      (_event, payload) =>
        requestRuntime<AgentAccountLoginCompleteResponse>(
          "agent.accounts.loginComplete",
          payload as AgentAccountLoginCompleteRequest
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
      LYRA_CHANNELS.agentOvernightStart,
      (_event, payload) =>
        requestRuntime<AgentOvernightStartResponse>(
          "agent.overnight.start",
          payload as AgentOvernightStartRequest
        )
    ],
    [
      LYRA_CHANNELS.agentOvernightList,
      () => requestRuntime<AgentOvernightListResponse>("agent.overnight.list")
    ],
    [
      LYRA_CHANNELS.agentOvernightStatus,
      (_event, payload) =>
        requestRuntime<AgentOvernightRunResponse>(
          "agent.overnight.status",
          (payload as AgentOvernightRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentOvernightLog,
      (_event, payload) =>
        requestRuntime<AgentOvernightRunResponse>(
          "agent.overnight.log",
          (payload as AgentOvernightRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentOvernightReview,
      (_event, payload) =>
        requestRuntime<AgentOvernightRunResponse>(
          "agent.overnight.review",
          (payload as AgentOvernightRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentOvernightCancel,
      (_event, payload) =>
        requestRuntime<AgentOvernightRunResponse>(
          "agent.overnight.cancel",
          (payload as AgentOvernightRunRequest | undefined) ?? {}
        )
    ]
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
