import type { WorkbenchDictionary } from "./types";
import { EN_US_DICTIONARY } from "./locales/en-US";
import { ZH_CN_DICTIONARY } from "./locales/zh-CN";

// Built-in locales are stable; local bundles are discovered at runtime through
// locale-state.ts and intentionally are not frozen into a build-time array.
export const BUILTIN_LOCALES = ["zh-CN", "en-US"] as const;

export const WORKBENCH_DICTIONARIES: Record<string, WorkbenchDictionary> = {
  "zh-CN": ZH_CN_DICTIONARY,
  "en-US": EN_US_DICTIONARY
};
