import type {
  AiCancelChatTurnRequest,
  AiChatSession,
  AiChatSessionSummary,
  AiChatTurnRequest,
  AiChatTurnResponse,
  AiDeleteProfileRequest,
  AiDiscoverModelsRequest,
  AiModelDiscoveryResult,
  AiProviderCatalogItem,
  AiProviderPreset,
  AiProfileValidationResult,
  AiProviderProfile,
  AiReadSessionHistoryRequest,
  AiReadSessionRequest,
  AiRuntimeEvent,
  AiSetDefaultProfileRequest,
  AiUpsertProfileRequest,
  AiValidateProfileRequest
} from "../../shared/ai";

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

export type NativeAiReadSessionRequest = AiReadSessionRequest & {
  readonly storageRoot: string;
};

export type NativeAiReadSessionHistoryRequest = AiReadSessionHistoryRequest & {
  readonly storageRoot: string;
};

export type NativeAiChatTurnRequest = AiChatTurnRequest & {
  readonly storageRoot: string;
};

export type NativeAiCancelChatTurnRequest = AiCancelChatTurnRequest & {
  readonly storageRoot: string;
};

export type AiNativeBindings = {
  readonly registerAiEventCallback: (listener: (eventJson: string) => void) => void;
  readonly readAiProfilesJson: (requestJson: string) => string;
  readonly readAiProviderCatalogJson: (requestJson: string) => string;
  readonly readAiPresetCatalogJson: (requestJson: string) => string;
  readonly upsertAiProfileJson: (requestJson: string) => string;
  readonly deleteAiProfileJson: (requestJson: string) => void;
  readonly setDefaultAiProfileJson: (requestJson: string) => string;
  readonly validateAiProfileJson: (requestJson: string) => string;
  readonly discoverAiModelsJson: (requestJson: string) => string;
  readonly refreshAiModelsJson: (requestJson: string) => string;
  readonly readAiSessionJson: (requestJson: string) => string;
  readonly readAiSessionHistoryJson: (requestJson: string) => string;
  readonly sendAiChatTurnJson: (requestJson: string) => string;
  readonly cancelAiChatTurnJson: (requestJson: string) => string;
  readonly shutdownAiRuntime: () => void;
};

export type AiNativeLoadResult =
  | {
      readonly ok: true;
      readonly bindings: AiNativeBindings;
      readonly loadedFrom: string;
    }
  | {
      readonly ok: false;
      readonly errorMessage: string;
      readonly triedPaths: readonly string[];
    };

export type ParsedAiEvent = AiRuntimeEvent;
export type ParsedAiProfiles = readonly AiProviderProfile[];
export type ParsedAiProviderCatalog = readonly AiProviderCatalogItem[];
export type ParsedAiPresetCatalog = readonly AiProviderPreset[];
export type ParsedAiSession = AiChatSession;
export type ParsedAiSessionHistory = readonly AiChatSessionSummary[];
export type ParsedAiTurnResponse = AiChatTurnResponse;
export type ParsedAiValidationResult = AiProfileValidationResult;
export type ParsedAiDiscoveryResult = AiModelDiscoveryResult;
