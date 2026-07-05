import type { EN_US_DICTIONARY } from "./locales/en-US";

// ponytail: 放宽为 string — 动态 locale 从磁盘发现（IPC），key 安全仍由 I18nKey 保证
export type WorkbenchLocale = string;

// ponytail: I18nKey 从 en-US 字典推导，不再手动维护 1100+ key union；en-US.ts 去掉类型标注让推导生效
export type I18nKey = keyof typeof EN_US_DICTIONARY;

export type WorkbenchDictionary = Record<I18nKey, string>;

// ponytail: agent 面板兼容类型 — 合并后 AgentChatI18nKey = I18nKey，不再需要独立子集
export type Locale = WorkbenchLocale;
export type AgentChatI18nKey = I18nKey;

// ponytail: i18next 类型增强 — t("key") 在编译期检查 key 是否存在于 translation namespace
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: typeof EN_US_DICTIONARY;
    };
  }
}