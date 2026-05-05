import type { AiProviderPreset } from "../../../shared/ai";

const PRESET_ALIASES: Readonly<Record<string, string>> = {
  mimo_token_plan_cn_openai: "mimo_token_plan",
  mimo_token_plan_sgp_openai: "mimo_token_plan",
  mimo_token_plan_ams_openai: "mimo_token_plan",
  mimo_token_plan_cn_anthropic: "mimo_token_plan",
  mimo_token_plan_sgp_anthropic: "mimo_token_plan",
  mimo_token_plan_ams_anthropic: "mimo_token_plan",
  mimo_api_anthropic: "mimo_api"
};

export const normalizePresetId = (presetId: string | null): string | null => {
  if (presetId === null) {
    return null;
  }
  const normalized = presetId.trim();
  if (normalized.length === 0) {
    return null;
  }
  return PRESET_ALIASES[normalized] ?? normalized;
};

export const resolvePreset = (
  presetCatalog: readonly AiProviderPreset[],
  presetId: string | null,
  providerId: string,
  protocolId: string
): AiProviderPreset | null =>
  presetCatalog.find((preset) => preset.id === normalizePresetId(presetId))
  ?? presetCatalog.find((preset) => preset.providerId === providerId && preset.protocolId === protocolId)
  ?? presetCatalog[0]
  ?? null;
