import type { WorkbenchDictionary } from "./types";
import { EN_US_DICTIONARY } from "./locales/en-US";
import { ZH_CN_DICTIONARY } from "./locales/zh-CN";

// ponytail: pseudo locale 门控 — env LYRA_PSEUDO_LOCALE=true 时追加 "pseudo" 到可选 locale 列表
const PSEUDO_LOCALE_ENABLED = import.meta.env?.LYRA_PSEUDO_LOCALE === "true";

// ponytail: 内置 locale — 动态 locale 由 P3a IPC readLocalBundles 异步发现并 addResourceBundle
export const BUILTIN_LOCALES = ["zh-CN", "en-US"] as const;

// ponytail: WORKBENCH_LOCALES — 内置 + pseudo（可选），动态 locale 在运行时通过 IPC 扩展
export const WORKBENCH_LOCALES: readonly string[] = PSEUDO_LOCALE_ENABLED
  ? [...BUILTIN_LOCALES, "pseudo"]
  : [...BUILTIN_LOCALES];

export const WORKBENCH_DICTIONARIES: Record<string, WorkbenchDictionary> = {
  "zh-CN": ZH_CN_DICTIONARY,
  "en-US": EN_US_DICTIONARY
};
