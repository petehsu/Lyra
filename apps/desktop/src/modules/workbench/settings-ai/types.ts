import type {
  AgentProviderCatalogProfile,
  AgentProviderCatalogSnapshot,
  AgentProviderRouteEntry,
  AgentConfigSnapshot,
  AgentConfigUpdateRequest,
  AgentRolesUpdateRequest,
  AgentAccountLoginCompleteRequest,
  AgentAccountLoginCompleteResponse,
  AgentAccountLoginStartRequest,
  AgentAccountLoginStartResponse,
  AgentAccountsSnapshot,
  AgentAccountRequest,
  AgentLoginProviderCatalogSnapshot,
  AgentProviderProfileSaveRequest,
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
  readonly refreshAgent: string;
  readonly agentConfigAriaLabel: string;
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
  readonly accountDefault: string;
  readonly loginProvidersTitle: string;
  readonly loginProvidersDescription: string;
  readonly startLogin: string;
  readonly completeLogin: string;
  readonly callbackInputLabel: string;
  readonly callbackInputPlaceholder: string;
  readonly loginCallbackDescription: string;
  readonly gmailLoginTitle: string;
  readonly gmailLoginDescription: string;
  readonly gmailClientIdLabel: string;
  readonly gmailClientSecretLabel: string;
  readonly gmailAccessTierLabel: string;
  readonly gmailAccessReadOnly: string;
  readonly gmailAccessFull: string;
  readonly apiKeyProviderTitle: string;
  readonly apiKeyProviderDescription: string;
  readonly localProviderTitle: string;
  readonly localProviderDescription: string;
  readonly saveAndDiscoverModels: string;
  readonly localModelsLabel: string;
  readonly localModelsPlaceholder: string;
  readonly localCapabilitiesTitle: string;
  readonly localSupportsImageInput: string;
  readonly localSupportsToolCalling: string;
  readonly localSupportsStreaming: string;
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
  readonly notificationsTitle: string;
  readonly notificationsDescription: string;
  readonly desktopNotificationsLabel: string;
  readonly ntfyTopicLabel: string;
  readonly ntfyServerLabel: string;
  readonly emailNotificationsLabel: string;
  readonly emailToLabel: string;
  readonly emailSmtpHostLabel: string;
  readonly emailSmtpPortLabel: string;
  readonly emailFromLabel: string;
  readonly emailPasswordLabel: string;
  readonly emailImapHostLabel: string;
  readonly emailImapPortLabel: string;
  readonly emailReplyLabel: string;
  readonly telegramNotificationsLabel: string;
  readonly telegramBotTokenLabel: string;
  readonly telegramChatIdLabel: string;
  readonly telegramReplyLabel: string;
  readonly discordNotificationsLabel: string;
  readonly discordBotTokenLabel: string;
  readonly discordChannelIdLabel: string;
  readonly discordBotUserIdLabel: string;
  readonly discordReplyLabel: string;
  readonly saveNotifications: string;
  readonly runtimeUnavailable: string;
  readonly fileEditorUnavailable: string;
  readonly configPathUnavailable: string;
  readonly sectionAgent: string;
  readonly sectionSessions: string;
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

export type SettingsAiModel = {
  readonly isSaving: boolean;
  readonly errorMessage: string | null;
  readonly profiles: readonly AgentProviderCatalogProfile[];
  readonly quickSetupRoutes: readonly AgentProviderRouteEntry[];
  readonly localRoutes: readonly AgentProviderRouteEntry[];
  readonly defaultProfileId: string | null;
  readonly agentConfig?: AgentConfigSnapshot | null;
  readonly agentAccounts?: AgentAccountsSnapshot | null;
  readonly agentLoginProviders?: AgentLoginProviderCatalogSnapshot | null;
  readonly agentProviderCatalog?: AgentProviderCatalogSnapshot | null;
  readonly setDefaultProfile: (profileId: string) => Promise<void>;
  readonly refreshAgent?: () => Promise<void>;
  readonly openAgentConfigFile?: () => Promise<void>;
  readonly updateAgentConfig?: (request: AgentConfigUpdateRequest) => Promise<void>;
  readonly saveAgentProviderProfile?: (
    request: AgentProviderProfileSaveRequest
  ) => Promise<void>;
  readonly refreshAgentModels?: (providerId: string) => Promise<void>;
  readonly startAgentAccountLogin?: (
    request: AgentAccountLoginStartRequest
  ) => Promise<AgentAccountLoginStartResponse | null>;
  readonly completeAgentAccountLogin?: (
    request: AgentAccountLoginCompleteRequest
  ) => Promise<AgentAccountLoginCompleteResponse | null>;
  readonly updateAgentRoles?: (
    request: AgentRolesUpdateRequest
  ) => Promise<void>;
  readonly switchAgentAccount?: (request: AgentAccountRequest) => Promise<void>;
  readonly removeAgentAccount?: (request: AgentAccountRequest) => Promise<void>;
};
