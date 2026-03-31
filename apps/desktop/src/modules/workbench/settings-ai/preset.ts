import type { AiProviderPreset } from "../../../shared/ai";

export const resolvePreset = (
  presetCatalog: readonly AiProviderPreset[],
  presetId: string | null,
  providerId: string,
  protocolId: string
): AiProviderPreset | null =>
  presetCatalog.find((preset) => preset.id === presetId)
  ?? presetCatalog.find((preset) => preset.providerId === providerId && preset.protocolId === protocolId)
  ?? presetCatalog[0]
  ?? null;
