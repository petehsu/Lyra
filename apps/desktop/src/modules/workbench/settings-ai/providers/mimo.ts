import type { AiProviderPreset } from "../../../../shared/ai";
import { apiKeyField } from "./shared";

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
  simpleFields: ["apiKey"],
  connectionFields: [],
  authFields: [apiKeyField(true, keyPlaceholder)],
  defaultConnectionConfig: { mimoRoute: route },
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
