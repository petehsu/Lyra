import type { AiProviderPreset } from "../../../../shared/ai";
import { apiKeyField, connectionField } from "./shared";

export const customPresets: readonly AiProviderPreset[] = [
  {
    id: "custom_openai_compatible",
    providerId: "custom_openai_compatible",
    protocolId: "custom_chat_completions",
    label: "OpenAI Compatible",
    description: "Any OpenAI-compatible chat completions endpoint.",
    section: "custom",
    iconKey: "custom_openai_compatible",
    defaultModel: "",
    discoveryMode: "dynamic",
    modelDiscoverySupported: true,
    customHeadersSupported: false,
    customModelsSupported: false,
    runtimeSupported: true,
    simpleFields: ["baseUrl", "apiKey"],
    connectionFields: [connectionField("baseUrl", "Base URL", "https://example.com/v1")],
    authFields: [apiKeyField(false)],
    defaultConnectionConfig: {},
    defaultAuthConfig: {},
    recommendedModels: []
  }
];
