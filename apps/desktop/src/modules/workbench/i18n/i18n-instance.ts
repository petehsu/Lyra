import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { EN_US_DICTIONARY } from "./locales/en-US";
import { ZH_CN_DICTIONARY } from "./locales/zh-CN";
import { createStaticBundleSource, createPseudoLocaleSource } from "./translation-source";
import type { WorkbenchLocale } from "./types";

export const I18N_FALLBACK = "en-US" as const;

const isDev = import.meta.env?.DEV ?? false;
// ponytail: pseudo locale 门控 — 生产环境不设 LYRA_PSEUDO_LOCALE，不影响运行时
const pseudoLocaleEnabled = import.meta.env?.LYRA_PSEUDO_LOCALE === "true";

// ponytail: 核心翻译源 — StaticBundleSource 同步加载内置字典
// 未来异步 source（LocalFile/Remote/PluginBundle）在 pack 激活时通过 addResourceBundle 合并
const coreSource = createStaticBundleSource("core", {
  "zh-CN": ZH_CN_DICTIONARY,
  "en-US": EN_US_DICTIONARY,
});

// ponytail: pseudo locale source — 包装 en-US bundle 做伪本地化变换，仅在 env 门控开启时加载
const pseudoBundle = pseudoLocaleEnabled
  ? createPseudoLocaleSource("pseudo", EN_US_DICTIONARY).loadBundle("pseudo")
  : null;

// ponytail: 单 translation namespace — agent keys 已合并进 en-US/zh-CN 字典
// ponytail: plural rules 依赖 i18next 内置 Intl.PluralRules — zh-CN/en-US 均为 CLDR 原生支持
void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: coreSource.loadBundle("zh-CN") },
    "en-US": { translation: coreSource.loadBundle("en-US") },
    ...(pseudoBundle ? { pseudo: { translation: pseudoBundle } } : {}),
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

// ponytail: 异步加载本地 locale bundles — 主进程扫描 ~/.lyra/locales/{locale}.json
// init 后异步合并到 i18next 实例，不阻塞首次渲染
// ponytail: window.lyraDesktop 由 preload 注入，测试环境可能不存在
void (async () => {
  try {
    const api = (globalThis as unknown as { lyraDesktop?: { i18n?: { readLocalBundles?: () => Promise<Readonly<Record<string, Record<string, string>>>> } } }).lyraDesktop;
    const bundles = await api?.i18n?.readLocalBundles?.();
    if (!bundles) return;
    for (const [locale, bundle] of Object.entries(bundles)) {
      void i18n.addResourceBundle(locale, "translation", bundle, true, true);
    }
  } catch {
    // ponytail: IPC 不可用时静默降级 — 内置 locale 仍可用
  }
})();