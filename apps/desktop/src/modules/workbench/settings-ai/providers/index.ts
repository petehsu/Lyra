import type { AiProviderPreset } from "../../../../shared/ai";
import { anthropicPresets } from "./anthropic";
import { customPresets } from "./custom";
import { googleAiPresets } from "./google-ai";
import { jcodePresets } from "./jcode";
import { localPresets } from "./local";
import { mimoPresets } from "./mimo";
import { openAiPresets } from "./openai";

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  ...openAiPresets,
  ...anthropicPresets,
  ...googleAiPresets,
  ...jcodePresets,
  ...mimoPresets,
  ...localPresets,
  ...customPresets
];
