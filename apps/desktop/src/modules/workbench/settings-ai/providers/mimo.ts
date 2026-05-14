import type { AiProviderPreset } from "../../../../shared/ai";
import { apiKeyField } from "./shared";

const mimoProtocolField = () => ({
  id: "mimoProtocol",
  label: "API format",
  kind: "select" as const,
  scope: "connection" as const,
  required: true,
  options: [
    { value: "openai", label: "OpenAI compatible" },
    { value: "anthropic", label: "Anthropic compatible" }
  ]
});

const mimoRegionField = () => ({
  id: "mimoRegion",
  label: "Token Plan cluster",
  kind: "select" as const,
  scope: "connection" as const,
  required: true,
  options: [
    { value: "cn", label: "China" },
    { value: "sgp", label: "Singapore" },
    { value: "ams", label: "Europe" }
  ]
});

const mimoPreset = ({
  id,
  label,
  description,
  route,
  keyPlaceholder
}: {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly route: "api" | "token_plan";
  readonly keyPlaceholder: string;
}): AiProviderPreset => ({
  id,
  providerId: "mimo",
  protocolId: "mimo_openai_chat_completions",
  label,
  description,
  section: "mainstream",
  iconKey: "mimo",
  defaultModel: "",
  discoveryMode: "dynamic",
  modelDiscoverySupported: true,
  customHeadersSupported: false,
  customModelsSupported: false,
  runtimeSupported: true,
  simpleFields: route === "token_plan" ? ["mimoProtocol", "mimoRegion", "apiKey"] : ["mimoProtocol", "apiKey"],
  connectionFields: route === "token_plan" ? [mimoProtocolField(), mimoRegionField()] : [mimoProtocolField()],
  authFields: [apiKeyField(true, keyPlaceholder)],
  defaultConnectionConfig: {
    mimoRoute: route,
    mimoProtocol: "openai",
    ...(route === "token_plan" ? { mimoRegion: "cn" } : {})
  },
  defaultAuthConfig: {},
  recommendedModels: []
});

export const mimoPresets: readonly AiProviderPreset[] = [
  mimoPreset({
    id: "mimo_api",
    label: "Xiaomi MiMo API",
    description: "Xiaomi MiMo hosted API with automatic endpoint routing.",
    route: "api",
    keyPlaceholder: "sk-..."
  }),
  mimoPreset({
    id: "mimo_token_plan",
    label: "Xiaomi MiMo Token Plan",
    description: "Xiaomi MiMo Token Plan with automatic region routing.",
    route: "token_plan",
    keyPlaceholder: "tp-..."
  })
];
