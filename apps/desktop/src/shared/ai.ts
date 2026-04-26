export const AI_PROVIDER_IDS = [
  "openai",
  "azure_openai",
  "openrouter",
  "anthropic",
  "google_ai",
  "deepseek",
  "xai",
  "mistral",
  "groq",
  "together",
  "fireworks",
  "vercel_ai_gateway",
  "ollama",
  "lmstudio",
  "custom_openai_compatible"
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_PROTOCOL_IDS = [
  "openai_chat_completions",
  "azure_openai_chat_completions",
  "openrouter_chat_completions",
  "anthropic_messages",
  "gemini_generate_content",
  "deepseek_chat_completions",
  "xai_chat_completions",
  "mistral_chat_completions",
  "groq_chat_completions",
  "together_chat_completions",
  "fireworks_chat_completions",
  "vercel_ai_gateway_chat_completions",
  "ollama_chat",
  "lmstudio_chat_completions",
  "custom_chat_completions",
] as const;

export type AiProtocolId = (typeof AI_PROTOCOL_IDS)[number];

export type AiProviderCatalogSection = "mainstream" | "local" | "custom";
export type AiProviderFieldScope = "connection" | "auth" | "advanced";
export type AiProviderFieldKind = "text" | "password" | "url" | "textarea" | "select" | "file";
export type AiModelDiscoveryMode = "dynamic" | "static" | "mixed";
export type AiModelDiscoveryStatus = "idle" | "ready" | "error";
export type AiProviderCapability = "full" | "static" | "pending";

export type AiProfileId = string;
export type AiProviderPresetId = string;
export type AiProviderIconKey = string;

export type AiProfileConnectionConfig = Readonly<Record<string, string>>;
export type AiProfileAuthConfig = Readonly<Record<string, string>>;
export type AiProviderHeaders = Readonly<Record<string, string>>;

export type AiProviderFieldOption = {
  readonly value: string;
  readonly label: string;
};

export type AiProviderFieldSchema = {
  readonly id: string;
  readonly label: string;
  readonly kind: AiProviderFieldKind;
  readonly scope: AiProviderFieldScope;
  readonly placeholder?: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly secret?: boolean;
  readonly options?: readonly AiProviderFieldOption[];
};

export type AiProviderModelEntry = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly contextWindow?: number;
  readonly supportsImages?: boolean;
  readonly supportsTools?: boolean;
  readonly runtimeMetadata?: AiModelRuntimeMetadata;
  readonly source: "preset" | "dynamic" | "custom";
};

export type AiModelRuntimeMetadata = {
  readonly shellType?: string;
  readonly applyPatchToolType?: string;
  readonly supportsSearchTool?: boolean;
  readonly supportsParallelToolCalls?: boolean;
  readonly supportsReasoningSummaries?: boolean;
  readonly supportVerbosity?: boolean;
  readonly webSearchToolType?: string;
  readonly supportsImageDetailOriginal?: boolean;
  readonly inputModalities?: readonly string[];
  readonly supportedTools?: readonly string[];
  readonly contextWindow?: number;
  readonly maxContextWindow?: number;
  readonly effectiveContextWindowPercent?: number;
};

export type AiProviderCatalogItem = {
  readonly id: AiProviderId;
  readonly label: string;
  readonly description: string;
  readonly protocolId: AiProtocolId;
  readonly iconKey: AiProviderIconKey;
  readonly recommended: boolean;
};

export type AiProviderPreset = {
  readonly id: AiProviderPresetId;
  readonly providerId: AiProviderId;
  readonly protocolId: AiProtocolId;
  readonly label: string;
  readonly description: string;
  readonly section: AiProviderCatalogSection;
  readonly iconKey: AiProviderIconKey;
  readonly defaultModel: string;
  readonly discoveryMode: AiModelDiscoveryMode;
  readonly capability: AiProviderCapability;
  readonly modelDiscoverySupported: boolean;
  readonly customHeadersSupported: boolean;
  readonly customModelsSupported: boolean;
  readonly runtimeSupported: boolean;
  readonly simpleFields: readonly string[];
  readonly connectionFields: readonly AiProviderFieldSchema[];
  readonly authFields: readonly AiProviderFieldSchema[];
  readonly defaultConnectionConfig: AiProfileConnectionConfig;
  readonly defaultAuthConfig: AiProfileAuthConfig;
  readonly recommendedModels: readonly AiProviderModelEntry[];
};

export type AiModelDiscoveryState = {
  readonly status: AiModelDiscoveryStatus;
  readonly lastCheckedAt: number | null;
  readonly errorMessage?: string;
  readonly models: readonly AiProviderModelEntry[];
};

export type AiProviderProfile = {
  readonly id: AiProfileId;
  readonly name: string;
  readonly providerId: AiProviderId;
  readonly protocolId: AiProtocolId;
  readonly runtimeProviderId: string;
  readonly runtimeSupported: boolean;
  readonly secretStatus: "configured" | "missing" | "env";
  readonly presetId: AiProviderPresetId | null;
  readonly connectionConfig: AiProfileConnectionConfig;
  readonly authConfig: AiProfileAuthConfig;
  readonly configuredSecretFields: readonly string[];
  readonly headers: AiProviderHeaders;
  readonly model: string;
  readonly customModels: readonly AiProviderModelEntry[];
  readonly discoveryState: AiModelDiscoveryState;
  readonly isDefault: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type AiUpsertProfileRequest = {
  readonly id?: AiProfileId;
  readonly name: string;
  readonly providerId: AiProviderId;
  readonly protocolId: AiProtocolId;
  readonly presetId?: AiProviderPresetId | null;
  readonly connectionConfig: Record<string, string>;
  readonly authConfig: Record<string, string>;
  readonly secretValues?: Record<string, string | null>;
  readonly clearSecretFields?: readonly string[];
  readonly headers?: Record<string, string>;
  readonly model: string;
  readonly customModels?: readonly AiProviderModelEntry[];
  readonly discoveryState?: AiModelDiscoveryState;
};

export type AiDeleteProfileRequest = {
  readonly id: AiProfileId;
};

export type AiSetDefaultProfileRequest = {
  readonly id: AiProfileId;
};

export type AiValidateProfileRequest = {
  readonly id?: AiProfileId;
  readonly name?: string;
  readonly providerId: AiProviderId;
  readonly protocolId: AiProtocolId;
  readonly presetId?: AiProviderPresetId | null;
  readonly connectionConfig: Record<string, string>;
  readonly authConfig: Record<string, string>;
  readonly secretValues?: Record<string, string | null>;
  readonly headers?: Record<string, string>;
  readonly model: string;
};

export type AiDiscoverModelsRequest = {
  readonly id?: AiProfileId;
  readonly providerId: AiProviderId;
  readonly protocolId: AiProtocolId;
  readonly presetId?: AiProviderPresetId | null;
  readonly connectionConfig: Record<string, string>;
  readonly authConfig: Record<string, string>;
  readonly secretValues?: Record<string, string | null>;
  readonly headers?: Record<string, string>;
  readonly forceRefresh?: boolean;
};

export type AiModelDiscoveryResult = {
  readonly providerId: AiProviderId;
  readonly protocolId: AiProtocolId;
  readonly status: "ready" | "error";
  readonly message: string;
  readonly checkedAt: number;
  readonly models: readonly AiProviderModelEntry[];
  readonly code?: string;
};

export type AiProfileValidationResult = {
  readonly ok: boolean;
  readonly message: string;
  readonly checkedAt: number;
  readonly code?: string;
};

// TODO(lyra): AiOpenAiChatGptAuthResult was removed — managed OAuth is not supported.
// If external OAuth re-auth is needed in the future, define a provider-neutral type here.
