import type { WorkbenchDictionary } from "./types";
import { EN_US_DICTIONARY } from "../../../shared/i18n/en-US";

// Built-in locales are stable; local bundles are discovered at runtime through
// locale-state.ts and intentionally are not frozen into a build-time array.
export const BUILTIN_LOCALES = ["en-US"] as const;

export const WORKBENCH_DICTIONARIES: Record<string, WorkbenchDictionary> = {
  "en-US": EN_US_DICTIONARY
};
