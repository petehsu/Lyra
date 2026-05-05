import type { AiProviderPreset } from "../../../../shared/ai";
import { apiKeyField } from "./shared";

export const googleAiPresets: readonly AiProviderPreset[] = [
  {
    id: "google_ai",
    providerId: "google_ai",
    protocolId: "gemini_generate_content",
    label: "Google AI",
    description: "Gemini Generate Content API.",
    section: "mainstream",
    iconKey: "google_ai",
    defaultModel: "",
    discoveryMode: "static",
    modelDiscoverySupported: false,
    customHeadersSupported: false,
    customModelsSupported: false,
    runtimeSupported: true,
    simpleFields: ["apiKey"],
    connectionFields: [],
    authFields: [apiKeyField()],
    defaultConnectionConfig: { baseUrl: "https://generativelanguage.googleapis.com" },
    defaultAuthConfig: {},
    recommendedModels: []
  }
];
