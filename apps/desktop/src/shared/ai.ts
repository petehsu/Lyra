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
  "mimo",
  "ollama",
  "lmstudio",
  "llama_cpp",
  "vllm",
  "mlx",
  "custom_openai_compatible"
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_PROTOCOL_IDS = [
  "openai_chat_completions",
  "openai_responses",
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
  "mimo_openai_chat_completions",
  "mimo_anthropic_messages",
  "ollama_chat",
  "lmstudio_chat_completions",
  "llama_cpp_server",
  "vllm_chat_completions",
  "llama_cpp_ffi",
  "mlx_ffi",
  "custom_chat_completions",
] as const;

export type AiProtocolId = (typeof AI_PROTOCOL_IDS)[number];

export type AiProviderCatalogSection = "mainstream" | "local" | "custom";
export type AiProviderFieldScope = "connection" | "auth" | "advanced";
export type AiProviderFieldKind = "text" | "password" | "url" | "textarea" | "select" | "file";
export type AiModelDiscoveryMode = "dynamic" | "static" | "mixed";
export type AiModelDiscoveryStatus = "idle" | "ready" | "error";

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
  readonly adapterId?: string;
  readonly compatibilitySource?: "native" | "openai-compatible" | "provider-compatible" | "custom";
  readonly localRuntimeKind?: "http" | "ffi";
  readonly localBackend?: "ollama" | "lmstudio" | "llama_cpp_server" | "vllm" | "llama_cpp_ffi" | "mlx_ffi";
  readonly nativeToolCalling?: boolean;
  readonly localModelPath?: string;
  readonly shellType?: string;
  readonly applyPatchToolType?: string;
  readonly supportsSearchTool?: boolean;
  readonly supportsReasoningSummaries?: boolean;
  readonly defaultReasoningLevel?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  readonly supportedReasoningLevels?: readonly ("none" | "minimal" | "low" | "medium" | "high" | "xhigh")[];
  readonly supportVerbosity?: boolean;
  readonly defaultVerbosity?: "low" | "medium" | "high";
  readonly webSearchToolType?: string;
  readonly supportsImageDetailOriginal?: boolean;
  readonly inputModalities?: readonly string[];
  readonly supportedTools?: readonly string[];
  readonly contextWindow?: number;
  readonly maxContextWindow?: number;
  readonly effectiveContextWindowPercent?: number;
  readonly protocolBehavior?: AiProtocolBehaviorSummary;
  readonly mimoRouteMode?: "api" | "token_plan";
  readonly mimoProtocolId?: "mimo_openai_chat_completions" | "mimo_anthropic_messages";
  readonly mimoBaseUrl?: string;
  readonly mimoFallbackRoutes?: readonly AiMimoRouteMetadata[];
};

export type AiMimoRouteMetadata = {
  readonly protocolId: "mimo_openai_chat_completions" | "mimo_anthropic_messages";
  readonly baseUrl: string;
  readonly region?: "cn" | "sgp" | "ams";
  readonly authScheme: "api_key" | "bearer";
  readonly latencyMs?: number;
};

export type AiProtocolBehaviorSummary = {
  readonly reasoningReplayField?: string;
  readonly preserveEmptyReasoning?: boolean;
  readonly requireAssistantReasoning?: boolean;
  readonly toolLoopSupported?: boolean;
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
  readonly runtimeMetadata?: AiModelRuntimeMetadata;
  readonly label: string;
  readonly description: string;
  readonly section: AiProviderCatalogSection;
  readonly iconKey: AiProviderIconKey;
  readonly defaultModel: string;
  readonly discoveryMode: AiModelDiscoveryMode;
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
  readonly modelRuntimeMetadata?: AiModelRuntimeMetadata | null;
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
  readonly headers?: Record<string, string>;
  readonly model: string;
  readonly modelRuntimeMetadata?: AiModelRuntimeMetadata | null;
  readonly customModels?: readonly AiProviderModelEntry[];
  readonly discoveryState?: AiModelDiscoveryState;
  readonly isDefault?: boolean;
};

export type AiDeleteProfileRequest = {
  readonly id: AiProfileId;
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

export type AiRuntimeHealth = {
  readonly backend: string;
  readonly transport: string;
  readonly version: string;
};

export type AiRuntimeConfigSnapshot = {
  readonly schemaVersion: string;
  readonly profiles: readonly AiProviderProfile[];
  readonly defaultProfileId: AiProfileId | null;
  readonly defaultProviderId: string | null;
  readonly defaultModelNames: readonly string[];
  readonly runtimeHealth: AiRuntimeHealth;
};

// TODO(lyra): AiOpenAiChatGptAuthResult was removed — managed OAuth is not supported.
// If external OAuth re-auth is needed in the future, define a provider-neutral type here.
