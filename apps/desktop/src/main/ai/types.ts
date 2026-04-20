import type {
  AiDeleteProfileRequest,
  AiDiscoverModelsRequest,
  AiModelDiscoveryResult,
  AiProfileValidationResult,
  AiProviderCatalogItem,
  AiProviderPreset,
  AiProviderProfile,
  AiSetDefaultProfileRequest,
  AiUpsertProfileRequest,
  AiValidateProfileRequest
} from "../../shared/ai";
import type {
  AiMemoryConfig,
  AgentAnswerQuestionRequest,
  AgentAnswerPlanQuestionRequest,
  AgentBindSessionProjectRequest,
  AgentEnterPlanModeRequest,
  AgentCreateSessionRequest,
  AgentDeleteSessionRequest,
  AgentGetPendingInteractionsRequest,
  AgentGetPlanRequest,
  AgentGetSessionRequest,
  AgentPlanState,
  AgentPendingInteraction,
  AgentResumeExecutionRequest,
  AgentResolvePlanApprovalRequest,
  AgentRuntimeEvent,
  AgentSendTurnRequest,
  AgentSendTurnResult,
  AgentSession,
  AgentSessionDetail,
  CommandApprovalSubmitRequest,} from "../../shared/agent";

export type AiIpcBridge = {
  readonly dispose: () => void;
};

export type NativeAiReadProfilesRequest = {
  readonly storageRoot: string;
};

export type NativeAiReadProviderCatalogRequest = NativeAiReadProfilesRequest;
export type NativeAiReadPresetCatalogRequest = NativeAiReadProfilesRequest;

export type NativeAiUpsertProfileRequest = AiUpsertProfileRequest & {
  readonly storageRoot: string;
};

export type NativeAiDeleteProfileRequest = AiDeleteProfileRequest & {
  readonly storageRoot: string;
};

export type NativeAiSetDefaultProfileRequest = AiSetDefaultProfileRequest & {
  readonly storageRoot: string;
};

export type NativeAiValidateProfileRequest = AiValidateProfileRequest & {
  readonly storageRoot: string;
};

export type NativeAiDiscoverModelsRequest = AiDiscoverModelsRequest & {
  readonly storageRoot: string;
};

export type NativeAgentListSessionsRequest = {
  readonly storageRoot: string;
};

export type NativeAgentCreateSessionRequest = AgentCreateSessionRequest & {
  readonly storageRoot: string;
};

export type NativeAgentGetSessionRequest = AgentGetSessionRequest & {
  readonly storageRoot: string;
};

export type NativeAgentDeleteSessionRequest = AgentDeleteSessionRequest & {
  readonly storageRoot: string;
};

export type NativeAgentBindSessionProjectRequest = AgentBindSessionProjectRequest & {
  readonly storageRoot: string;
};

export type NativeAgentSendTurnRequest = AgentSendTurnRequest & {
  readonly storageRoot: string;
};

export type NativeAgentEnterPlanModeRequest = AgentEnterPlanModeRequest & {
  readonly storageRoot: string;
};

export type NativeAgentGetPlanRequest = AgentGetPlanRequest & {
  readonly storageRoot: string;
};

export type NativeAgentGetPendingInteractionsRequest = AgentGetPendingInteractionsRequest & {
  readonly storageRoot: string;
};

export type NativeAgentAnswerQuestionRequest = AgentAnswerQuestionRequest & {
  readonly storageRoot: string;
};

export type NativeAgentAnswerPlanQuestionRequest = AgentAnswerPlanQuestionRequest & {
  readonly storageRoot: string;
};

export type NativeAgentResolvePlanApprovalRequest = AgentResolvePlanApprovalRequest & {
  readonly storageRoot: string;
};

export type NativeAgentResumeExecutionRequest = AgentResumeExecutionRequest & {
  readonly storageRoot: string;
};

export type NativeAgentMemoryConfigRequest = {
  readonly storageRoot: string;
};

export type NativeAgentUpdateMemoryConfigRequest = {
  readonly storageRoot: string;
  readonly config: AiMemoryConfig;
};

export type NativeCommandApprovalSubmitRequest = CommandApprovalSubmitRequest & {
  readonly storageRoot: string;
};

export type ParsedAiProfiles = readonly AiProviderProfile[];
export type ParsedAiProviderCatalog = readonly AiProviderCatalogItem[];
export type ParsedAiPresetCatalog = readonly AiProviderPreset[];
export type ParsedAiValidationResult = AiProfileValidationResult;
export type ParsedAiDiscoveryResult = AiModelDiscoveryResult;
export type ParsedAgentSessions = readonly AgentSession[];
export type ParsedAgentSessionDetail = AgentSessionDetail;
export type ParsedAgentPlanState = AgentPlanState | null;
export type ParsedAgentPendingInteractions = readonly AgentPendingInteraction[];
export type ParsedAgentSendTurnResult = AgentSendTurnResult;
export type ParsedAgentRuntimeEvent = AgentRuntimeEvent;
export type ParsedAgentMemoryConfig = AiMemoryConfig;
