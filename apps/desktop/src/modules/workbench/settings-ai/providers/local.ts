import type { AiProviderPreset } from "../../../../shared/ai";
import { apiKeyField, connectionField } from "./shared";

export const localPresets: readonly AiProviderPreset[] = [
  {
    id: "ollama",
    providerId: "ollama",
    protocolId: "ollama_chat",
    label: "Ollama",
    description: "Local Ollama runtime.",
    section: "local",
    iconKey: "ollama",
    defaultModel: "",
    discoveryMode: "dynamic",
    modelDiscoverySupported: true,
    customHeadersSupported: false,
    customModelsSupported: false,
    runtimeSupported: true,
    simpleFields: ["baseUrl"],
    connectionFields: [connectionField("baseUrl", "Base URL", "http://127.0.0.1:11434")],
    authFields: [],
    defaultConnectionConfig: { baseUrl: "http://127.0.0.1:11434" },
    defaultAuthConfig: {},
    recommendedModels: []
  },
  {
    id: "lmstudio",
    providerId: "lmstudio",
    protocolId: "lmstudio_chat_completions",
    label: "LM Studio",
    description: "Local OpenAI-compatible LM Studio server.",
    section: "local",
    iconKey: "lmstudio",
    defaultModel: "",
    discoveryMode: "dynamic",
    modelDiscoverySupported: true,
    customHeadersSupported: false,
    customModelsSupported: false,
    runtimeSupported: true,
    simpleFields: ["baseUrl", "apiKey"],
    connectionFields: [connectionField("baseUrl", "Base URL", "http://127.0.0.1:1234/v1")],
    authFields: [apiKeyField(false)],
    defaultConnectionConfig: { baseUrl: "http://127.0.0.1:1234/v1" },
    defaultAuthConfig: {},
    recommendedModels: []
  }
];
