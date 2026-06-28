import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { EN_US_DICTIONARY } from "./locales/en-US";
import { ZH_CN_DICTIONARY } from "./locales/zh-CN";
import type { WorkbenchLocale } from "./types";

export const I18N_FALLBACK = "en-US" as const;

const isDev = import.meta.env?.DEV ?? false;

// ponytail: 单 translation namespace — agent keys 已合并进 en-US/zh-CN 字典
// ponytail: plural rules 依赖 i18next 内置 Intl.PluralRules — zh-CN/en-US 均为 CLDR 原生支持
void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: ZH_CN_DICTIONARY },
    "en-US": { translation: EN_US_DICTIONARY },
  },
  lng: "zh-CN",
  fallbackLng: I18N_FALLBACK,
  defaultNS: "translation",
  ns: ["translation"],
  // ponytail: 字典使用 {name} 单括号插值（非 i18next 默认 {{name}}），需显式覆盖 prefix/suffix
  interpolation: { escapeValue: false, prefix: "{", suffix: "}" },
  // ponytail: plural 后缀 _one/_other — i18next 按 count 自动选择，pluralSeparator 默认 "_"
  // ponytail: 只加载当前语言，避免 missingKeys 噪音
  load: "currentOnly",
  // ponytail: 生产环境不触发 saveMissing，开发环境 warn 便于排查
  saveMissing: isDev,
  missingKeyHandler: (
    _lngs: readonly string[],
    _ns: string,
    key: string,
  ): void => {
    console.warn(`[i18n] missing key: ${key}`);
  },
  // ponytail: 生产环境关闭 React suspend — 只有 2 个 locale 全量加载，无需 dynamic import
  react: { useSuspense: false },
});

export const changeI18nLocale = (locale: WorkbenchLocale) => i18n.changeLanguage(locale);
export default i18n;