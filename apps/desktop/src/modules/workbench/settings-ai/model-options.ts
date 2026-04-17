import type {
  AiModelDiscoveryResult,
  AiProviderModelEntry,
  AiProviderPreset
} from "../../../shared/ai";
import { parseCustomModels } from "./draft";

const pushUniqueModels = (
  result: Map<string, AiProviderModelEntry>,
  entries: readonly AiProviderModelEntry[]
): void => {
  entries.forEach((entry) => {
    const id = entry.id.trim();
    if (id.length === 0 || result.has(id)) {
      return;
    }
    result.set(id, entry);
  });
};

export const buildModelOptions = (
  preset: AiProviderPreset | null,
  discoveryResult: AiModelDiscoveryResult | null,
  modelsText: string
): readonly AiProviderModelEntry[] => {
  const result = new Map<string, AiProviderModelEntry>();
  pushUniqueModels(result, discoveryResult?.models ?? []);
  pushUniqueModels(result, preset?.recommendedModels ?? []);
  pushUniqueModels(
    result,
    parseCustomModels(modelsText)
  );
  return [...result.values()];
};
