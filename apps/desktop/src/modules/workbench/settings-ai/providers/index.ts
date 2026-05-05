import type { AiProviderPreset } from "../../../../shared/ai";
import { anthropicPresets } from "./anthropic";
import { customPresets } from "./custom";
import { googleAiPresets } from "./google-ai";
import { localPresets } from "./local";
import { mimoPresets } from "./mimo";
import { openAiPresets } from "./openai";

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  ...openAiPresets,
  ...anthropicPresets,
  ...googleAiPresets,
  ...mimoPresets,
  ...localPresets,
  ...customPresets
];
