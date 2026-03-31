import type { WorkbenchDictionary, WorkbenchLocale } from "./types";
import { EN_US_DICTIONARY } from "./locales/en-US";
import { ZH_CN_DICTIONARY } from "./locales/zh-CN";

export const WORKBENCH_LOCALES: readonly WorkbenchLocale[] = ["zh-CN", "en-US"] as const;

export const WORKBENCH_DICTIONARIES: Record<WorkbenchLocale, WorkbenchDictionary> = {
  "zh-CN": ZH_CN_DICTIONARY,
  "en-US": EN_US_DICTIONARY
};
