import type { AiProviderPreset } from "../../../../shared/ai";
import { apiKeyField } from "./shared";

export const openAiPresets: readonly AiProviderPreset[] = [
  {
    id: "openai",
    providerId: "openai",
    protocolId: "openai_chat_completions",
    label: "OpenAI",
    description: "OpenAI hosted models.",
    section: "mainstream",
    iconKey: "openai",
    defaultModel: "",
    discoveryMode: "dynamic",
    modelDiscoverySupported: true,
    customHeadersSupported: false,
    customModelsSupported: false,
    runtimeSupported: true,
    simpleFields: ["apiKey"],
    connectionFields: [],
    authFields: [apiKeyField()],
    defaultConnectionConfig: { baseUrl: "https://api.openai.com/v1" },
    defaultAuthConfig: {},
    recommendedModels: []
  },
  {
    id: "openai_responses",
    providerId: "openai",
    protocolId: "openai_responses",
    runtimeMetadata: {
      adapterId: "openai_responses",
      compatibilitySource: "native",
      nativeToolCalling: true
    },
    label: "OpenAI Responses",
    description: "OpenAI Responses API with native tool-call streaming.",
    section: "mainstream",
    iconKey: "openai",
    defaultModel: "",
    discoveryMode: "dynamic",
    modelDiscoverySupported: true,
    customHeadersSupported: false,
    customModelsSupported: false,
    runtimeSupported: true,
    simpleFields: ["apiKey"],
    connectionFields: [],
    authFields: [apiKeyField()],
    defaultConnectionConfig: { baseUrl: "https://api.openai.com/v1" },
    defaultAuthConfig: {},
    recommendedModels: []
  }
];
