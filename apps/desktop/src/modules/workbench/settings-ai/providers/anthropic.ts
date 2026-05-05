import type { AiProviderPreset } from "../../../../shared/ai";
import { apiKeyField } from "./shared";

export const anthropicPresets: readonly AiProviderPreset[] = [
  {
    id: "anthropic",
    providerId: "anthropic",
    protocolId: "anthropic_messages",
    label: "Anthropic",
    description: "Anthropic Claude models.",
    section: "mainstream",
    iconKey: "anthropic",
    defaultModel: "",
    discoveryMode: "static",
    modelDiscoverySupported: false,
    customHeadersSupported: false,
    customModelsSupported: false,
    runtimeSupported: true,
    simpleFields: ["apiKey"],
    connectionFields: [],
    authFields: [apiKeyField()],
    defaultConnectionConfig: { baseUrl: "https://api.anthropic.com" },
    defaultAuthConfig: {},
    recommendedModels: []
  }
];
