import type {
  AiProviderModelEntry,
  AiProviderPreset,
  AiProviderProfile,
} from "../../../shared/ai";
import type {
  JcodeConfigSnapshot,
  JcodeConfigUpdateRequest,
  JcodeAgentRolesUpdateRequest,
  JcodeAccountsResponse,
  JcodeAccountRequest,
  JcodeProviderProfileSaveRequest,
  JcodeRegisteredCommand,
} from "../../../shared/desktop-bridge";

export type SettingsAiLabels = {
  readonly categoryLabel: string;
  readonly profilesTitle: string;
  readonly providerTitle: string;
  readonly connectionTitle: string;
  readonly additionalFieldsTitle: string;
  readonly addProfile: string;
  readonly editProfile: string;
  readonly saveProfile: string;
  readonly deleteProfile: string;
  readonly cancel: string;
  readonly profileNameLabel: string;
  readonly profileNamePlaceholder: string;
  readonly urlLabel: string;
  readonly urlPlaceholder: string;
  readonly keyLabel: string;
  readonly keyPlaceholder: string;
  readonly modelLabel: string;
  readonly mainModelLabel: string;
  readonly modelModeAllLabel: string;
  readonly modelModeCustomLabel: string;
  readonly modelPlaceholder: string;
  readonly modelsHelp: string;
  readonly headersLabel: string;
  readonly headersPlaceholder: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly recommendedSection: string;
  readonly allSection: string;
  readonly customSection: string;
  readonly secretConfigured: string;
  readonly secretMissing: string;
  readonly noDiscoveredModels: string;
  readonly advancedSettingsLabel: string;
  readonly selectProviderLabel: string;
  readonly deleteProfileConfirmTitle: string;
  readonly deleteProfileConfirmDescription: string;
  readonly configFileTitle: string;
  readonly configFileDescription: string;
  readonly openConfigFile: string;
  readonly refreshJcode: string;
  readonly jcodeConfigAriaLabel: string;
  readonly providerAutoFallback: string;
  readonly defaultModelFallback: string;
  readonly customProviderFallback: string;
  readonly accountsTitle: string;
  readonly accountsAriaLabel: string;
  readonly noDefaultProvider: string;
  readonly noDefaultModel: string;
  readonly accountsEmptyTitle: string;
  readonly accountsEmptyDescription: string;
  readonly accountConfigured: string;
  readonly accountNotConfigured: string;
  readonly removeAccount: string;
  readonly providerProfileTitle: string;
  readonly authHeaderLabel: string;
  readonly roleModelsTitle: string;
  readonly roleSwarmSubagentLabel: string;
  readonly roleReviewLabel: string;
  readonly roleJudgeLabel: string;
  readonly roleMemoryLabel: string;
  readonly roleAmbientLabel: string;
  readonly roleProviderDefaultPlaceholder: string;
  readonly roleMemoryDefaultPlaceholder: string;
  readonly saveRoleModels: string;
  readonly commandsAriaLabel: string;
  readonly runtimeUnavailable: string;
  readonly fileEditorUnavailable: string;
  readonly configPathUnavailable: string;
  readonly sectionJcode: string;
  readonly sectionSessions: string;
  readonly sectionCommands: string;
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

export type SettingsAiModelSelectionMode = "custom" | "all";

export type SettingsAiDraft = {
  readonly id: string | null;
  readonly name: string;
  readonly providerId: string;
  readonly protocolId: string;
  readonly presetId: string | null;
  readonly connectionConfig: Readonly<Record<string, string>>;
  readonly authConfig: Readonly<Record<string, string>>;
  readonly secretValues: Readonly<Record<string, string>>;
  readonly configuredSecretFields: readonly string[];
  readonly headersText: string;
  readonly modelSelectionMode: SettingsAiModelSelectionMode;
  readonly modelsText: string;
  readonly isDefault: boolean;
};

export type SettingsAiPresetSection = {
  readonly id: "mainstream" | "local" | "custom";
  readonly label: string;
  readonly presets: readonly AiProviderPreset[];
};

export type SettingsAiModel = {
  readonly isSaving: boolean;
  readonly errorMessage: string | null;
  readonly profiles: readonly AiProviderProfile[];
  readonly presetSections: readonly SettingsAiPresetSection[];
  readonly selectedProfileId: string | null;
  readonly defaultProfileId: string | null;
  readonly defaultProviderId: string | null;
  readonly defaultModelNames: readonly string[];
  readonly selectedPresetId: string | null;
  readonly selectedPreset: AiProviderPreset | null;
  readonly jcodeConfig?: JcodeConfigSnapshot | null;
  readonly jcodeAccounts?: JcodeAccountsResponse | null;
  readonly jcodeCommands?: readonly JcodeRegisteredCommand[];
  readonly draft: SettingsAiDraft;
  readonly modelSelectionMode: SettingsAiModelSelectionMode;
  readonly availableModels: readonly AiProviderModelEntry[];
  readonly selectProfile: (profileId: string | null) => void;
  readonly applyPreset: (presetId: string) => void;
  readonly updateDraftName: (value: string) => void;
  readonly updateDraftModelSelectionMode: (value: SettingsAiModelSelectionMode) => void;
  readonly updateDraftHeadersText: (value: string) => void;
  readonly updateDraftModelsText: (value: string) => void;
  readonly updateDraftField: (
    target: "connection" | "auth" | "secret",
    fieldId: string,
    value: string
  ) => void;
  readonly saveProfile: () => Promise<void>;
  readonly deleteProfile: (profileId?: string) => Promise<void>;
  readonly deleteProviderModels: (providerId: string) => Promise<void>;
  readonly deleteConfiguredModel: (profileId: string, modelId: string) => Promise<void>;
  readonly setDefaultProfile: (profileId: string) => Promise<void>;
  readonly refreshJcode?: () => Promise<void>;
  readonly openJcodeConfigFile?: () => Promise<void>;
  readonly updateJcodeConfig?: (request: JcodeConfigUpdateRequest) => Promise<void>;
  readonly saveJcodeProviderProfile?: (
    request: JcodeProviderProfileSaveRequest
  ) => Promise<void>;
  readonly updateJcodeAgentRoles?: (
    request: JcodeAgentRolesUpdateRequest
  ) => Promise<void>;
  readonly switchJcodeAccount?: (request: JcodeAccountRequest) => Promise<void>;
  readonly removeJcodeAccount?: (request: JcodeAccountRequest) => Promise<void>;
};
