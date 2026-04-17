import type {
  AiModelDiscoveryResult,
  AiProviderCatalogItem,
  AiProviderId,
  AiProtocolId,
  AiProviderPreset,
  AiProviderProfile
} from "../../../shared/ai";
import type { BrowserUseRuntimeStatus } from "../../../shared/browser-use";
import type {
  WorkbenchBrowserAutomationEngine,
  WorkbenchLyraDirectMicroExecutorBudget,
} from "../preferences";

export type SettingsAiLabels = {
  readonly categoryLabel: string;
  readonly profilesTitle: string;
  readonly providerTitle: string;
  readonly connectionTitle: string;
  readonly additionalFieldsTitle: string;
  readonly statusTitle: string;
  readonly addProfile: string;
  readonly saveProfile: string;
  readonly deleteProfile: string;
  readonly setDefaultProfile: string;
  readonly clearApiKey: string;
  readonly testConnection: string;
  readonly discoverModels: string;
  readonly refreshModels: string;
  readonly authorizeChatGpt: string;
  readonly authorizeChatGptDeviceCode: string;
  readonly profileNameLabel: string;
  readonly profileNamePlaceholder: string;
  readonly urlLabel: string;
  readonly urlPlaceholder: string;
  readonly keyLabel: string;
  readonly keyPlaceholder: string;
  readonly modelLabel: string;
  readonly modelPlaceholder: string;
  readonly modelsHelp: string;
  readonly headersLabel: string;
  readonly headersPlaceholder: string;
  readonly defaultBadge: string;
  readonly defaultProfileLabel: string;
  readonly statusIdle: string;
  readonly statusSaved: string;
  readonly statusDeleted: string;
  readonly statusDefaultUpdated: string;
  readonly statusChatGptAuthorized: string;
  readonly statusLastChecked: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly recommendedSection: string;
  readonly allSection: string;
  readonly customSection: string;
  readonly secretConfigured: string;
  readonly secretMissing: string;
  readonly noDiscoveredModels: string;
  readonly capabilityLabel: string;
  readonly capabilityFull: string;
  readonly capabilityStatic: string;
  readonly capabilityPending: string;
  readonly modelSourceDynamic: string;
  readonly modelSourcePreset: string;
  readonly modelSourceCustom: string;
  readonly memoryConfigTitle: string;
  readonly memoryConfigDescription: string;
  readonly memoryConfigPlaceholder: string;
  readonly memoryConfigLoad: string;
  readonly memoryConfigSave: string;
  readonly memoryConfigStatusIdle: string;
  readonly memoryConfigStatusLoaded: string;
  readonly memoryConfigStatusSaved: string;
  readonly memoryConfigStatusInvalidJson: string;
  readonly browserAutomationTitle: string;
  readonly browserAutomationDescription: string;
  readonly browserAutomationOptionLyraDirect: string;
  readonly browserAutomationOptionLyraDirectDescription: string;
  readonly browserAutomationOptionBrowserUse: string;
  readonly browserAutomationOptionBrowserUseDescription: string;
  readonly browserAutomationOptionSmart: string;
  readonly browserAutomationOptionSmartDescription: string;
  readonly browserAutomationStatusChecking: string;
  readonly browserAutomationStatusHealthy: string;
  readonly browserAutomationStatusUnavailable: string;
  readonly browserAutomationStatusReasonMissingBundle: string;
  readonly browserAutomationStatusReasonIntegrityFailed: string;
  readonly browserAutomationStatusReasonDaemonLaunchFailed: string;
  readonly browserAutomationStatusReasonBridgeUnavailable: string;
  readonly browserAutomationStatusReasonUnsupportedPlatform: string;
  readonly lyraDirectAdvancedTitle: string;
  readonly lyraDirectAdvancedDescription: string;
  readonly lyraDirectMicroExecutorBudgetLabel: string;
  readonly lyraDirectMicroExecutorBudgetConservative: string;
  readonly lyraDirectMicroExecutorBudgetConservativeDescription: string;
  readonly lyraDirectMicroExecutorBudgetBalanced: string;
  readonly lyraDirectMicroExecutorBudgetBalancedDescription: string;
  readonly lyraDirectMicroExecutorBudgetAggressive: string;
  readonly lyraDirectMicroExecutorBudgetAggressiveDescription: string;
};

export type SettingsAiDraft = {
  readonly id: string | null;
  readonly name: string;
  readonly providerId: AiProviderId;
  readonly protocolId: AiProtocolId;
  readonly presetId: string | null;
  readonly connectionConfig: Record<string, string>;
  readonly authConfig: Record<string, string>;
  readonly secretValues: Record<string, string>;
  readonly clearSecretFields: readonly string[];
  readonly configuredSecretFields: readonly string[];
  readonly headersText: string;
  readonly modelsText: string;
  readonly isDefault: boolean;
};

export type SettingsAiModel = {
  readonly profiles: readonly AiProviderProfile[];
  readonly providerCatalog: readonly AiProviderCatalogItem[];
  readonly presetCatalog: readonly AiProviderPreset[];
  readonly selectedProfileId: string | null;
  readonly draft: SettingsAiDraft;
  readonly discoveryResult: AiModelDiscoveryResult | null;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly isTesting: boolean;
  readonly isDiscovering: boolean;
  readonly isMemoryConfigLoading: boolean;
  readonly isMemoryConfigSaving: boolean;
  readonly statusMessage: string;
  readonly statusTone: "neutral" | "success" | "error";
  readonly lastCheckedAt: number | null;
  readonly memoryConfigText: string;
  readonly memoryConfigStatus: string;
  readonly memoryConfigStatusTone: "neutral" | "success" | "error";
  readonly browserAutomationEngine: WorkbenchBrowserAutomationEngine;
  readonly lyraDirectMicroExecutorBudget: WorkbenchLyraDirectMicroExecutorBudget;
  readonly browserUseRuntimeStatus: BrowserUseRuntimeStatus;
  readonly selectProfile: (profileId: string) => void;
  readonly createProfileDraft: () => void;
  readonly selectPreset: (presetId: string) => void;
  readonly updateName: (value: string) => void;
  readonly updateUrl: (value: string) => void;
  readonly updateKey: (value: string) => void;
  readonly updateModelsText: (value: string) => void;
  readonly toggleModelOption: (modelId: string) => void;
  readonly updateDraftField: (
    target: "connection" | "auth" | "secret",
    fieldId: string,
    value: string
  ) => void;
  readonly updateHeadersText: (value: string) => void;
  readonly clearSecretField: (fieldId: string) => void;
  readonly authorizeOpenAiChatGpt: () => Promise<void>;
  readonly authorizeOpenAiChatGptDeviceCode: () => Promise<void>;
  readonly saveProfile: () => Promise<void>;
  readonly deleteProfile: () => Promise<void>;
  readonly setDefaultProfile: () => Promise<void>;
  readonly testConnection: () => Promise<void>;
  readonly discoverModels: () => Promise<void>;
  readonly refreshDiscoveredModels: () => Promise<void>;
  readonly loadMemoryConfig: () => Promise<void>;
  readonly saveMemoryConfig: () => Promise<void>;
  readonly updateMemoryConfigText: (value: string) => void;
  readonly setBrowserAutomationEngine: (value: WorkbenchBrowserAutomationEngine) => void;
  readonly setLyraDirectMicroExecutorBudget: (
    value: WorkbenchLyraDirectMicroExecutorBudget
  ) => void;
};
