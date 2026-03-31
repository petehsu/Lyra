export const AI_PROVIDER_IDS = [
  "openai",
  "azure_openai",
  "openrouter",
  "anthropic",
  "google_ai",
  "vertex_ai",
  "amazon_bedrock",
  "ollama",
  "lmstudio",
  "deepseek",
  "xai",
  "mistral",
  "moonshot",
  "groq",
  "together",
  "fireworks",
  "siliconflow",
  "nebius",
  "cerebras",
  "vercel_ai_gateway",
  "custom_openai_compatible"
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_PROTOCOL_IDS = [
  "openai_compatible",
  "anthropic_messages",
  "gemini_generate_content",
  "bedrock_converse",
  "ollama_chat",
  "lmstudio_openai"
] as const;

export type AiProtocolId = (typeof AI_PROTOCOL_IDS)[number];

export type AiProviderCatalogSection = "recommended" | "all" | "custom";
export type AiProviderFieldScope = "connection" | "auth" | "advanced";
export type AiProviderFieldKind = "text" | "password" | "url" | "textarea" | "select" | "file";
export type AiModelDiscoveryMode = "dynamic" | "static" | "mixed";
export type AiModelDiscoveryStatus = "idle" | "ready" | "error";
export type AiProviderCapability = "full" | "static" | "pending";

export type AiProfileId = string;
export type AiChatSessionId = string;
export type AiChatTurnId = string;
export type AiChatMessageId = string;
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
  readonly source: "preset" | "dynamic" | "custom";
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
};

export type AiProfileValidationResult = {
  readonly ok: boolean;
  readonly message: string;
  readonly checkedAt: number;
};

export type AiChatMode = "chat" | "agent" | "oma";
export type AiChatMessageRole = "user" | "assistant" | "system" | "tool";
export type AiChatMessageStatus = "pending" | "streaming" | "completed" | "error";

export type AiChatTextToken = {
  readonly kind: "text";
  readonly value: string;
};

export type AiChatFileToken = {
  readonly kind: "file";
  readonly name: string;
  readonly entryKind: "file" | "directory";
  readonly source: "directory" | "trash";
  readonly path?: string;
  readonly iconKind?: string;
};

export type AiChatToken =
  | AiChatTextToken
  | AiChatFileToken;

export type AiChatMessage = {
  readonly id: AiChatMessageId;
  readonly sessionId: AiChatSessionId;
  readonly turnId?: AiChatTurnId;
  readonly role: AiChatMessageRole;
  readonly mode: AiChatMode;
  readonly content: string;
  readonly status: AiChatMessageStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly tokens?: readonly AiChatToken[];
};

export type AiChatSessionSummary = {
  readonly id: AiChatSessionId;
  readonly title: string;
  readonly updatedAt: number;
  readonly summary: string;
  readonly mode: AiChatMode;
};

export type AiChatSession = {
  readonly id: AiChatSessionId;
  readonly title: string;
  readonly updatedAt: number;
  readonly summary: string;
  readonly mode: AiChatMode;
  readonly activeTurnId: AiChatTurnId | null;
  readonly messages: readonly AiChatMessage[];
};

export type AiReadSessionRequest = {
  readonly sessionId: AiChatSessionId;
  readonly fallbackTitle?: string;
  readonly preferredMode?: AiChatMode;
};

export type AiReadSessionHistoryRequest = {
  readonly limit?: number;
};

export type AiChatTurnRequest = {
  readonly sessionId: AiChatSessionId;
  readonly mode: AiChatMode;
  readonly text: string;
  readonly tokens: readonly AiChatToken[];
  readonly fallbackTitle?: string;
};

export type AiChatTurnResponse = {
  readonly turnId: AiChatTurnId;
  readonly session: AiChatSession;
};

export type AiCancelChatTurnRequest = {
  readonly sessionId: AiChatSessionId;
  readonly turnId: AiChatTurnId;
};

export type AiRuntimeEvent = {
  readonly kind: "session_updated";
  readonly session: AiChatSession;
  readonly summary: AiChatSessionSummary;
};
