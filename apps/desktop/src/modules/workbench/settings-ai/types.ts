import type { LyraRuntimeHealth } from "../../../shared/lyra-runtime";
import type {
  AiProviderModelEntry,
  AiProviderPreset,
  AiProviderProfile,
} from "../../../shared/ai";

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
};

export type SettingsAiDraft = {
  readonly id: string | null;
  readonly name: string;
  readonly providerId: string;
  readonly protocolId: string;
  readonly presetId: string | null;
  readonly connectionConfig: Readonly<Record<string, string>>;
  readonly authConfig: Readonly<Record<string, string>>;
  readonly secretValues: Readonly<Record<string, string>>;
  readonly clearSecretFields: readonly string[];
  readonly configuredSecretFields: readonly string[];
  readonly headersText: string;
  readonly modelsText: string;
  readonly isDefault: boolean;
};

export type SettingsAiPresetSection = {
  readonly id: "mainstream" | "local" | "custom";
  readonly label: string;
  readonly presets: readonly AiProviderPreset[];
};

export type SettingsAiModel = {
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly isRefreshingModels: boolean;
  readonly statusMessage: string;
  readonly statusTone: "neutral" | "success" | "error";
  readonly runtimeHealth: LyraRuntimeHealth | null;
  readonly profiles: readonly AiProviderProfile[];
  readonly presetSections: readonly SettingsAiPresetSection[];
  readonly selectedProfileId: string | null;
  readonly defaultProfileId: string | null;
  readonly defaultProviderId: string | null;
  readonly defaultProfileLabel: string | null;
  readonly defaultModelNames: readonly string[];
  readonly selectedPresetId: string | null;
  readonly selectedPreset: AiProviderPreset | null;
  readonly draft: SettingsAiDraft;
  readonly availableModels: readonly AiProviderModelEntry[];
  readonly selectedModelIds: readonly string[];
  readonly selectProfile: (profileId: string | null) => void;
  readonly applyPreset: (presetId: string) => void;
  readonly updateDraftName: (value: string) => void;
  readonly updateDraftHeadersText: (value: string) => void;
  readonly updateDraftModelsText: (value: string) => void;
  readonly updateDraftField: (
    target: "connection" | "auth" | "secret",
    fieldId: string,
    value: string
  ) => void;
  readonly clearSecretField: (fieldId: string) => void;
  readonly toggleModelSelection: (modelId: string) => void;
  readonly refreshConfig: () => Promise<void>;
  readonly refreshModels: () => Promise<void>;
  readonly validateProfile: () => Promise<void>;
  readonly saveProfile: () => Promise<void>;
  readonly deleteProfile: () => Promise<void>;
  readonly setDefaultProfile: () => Promise<void>;
};
