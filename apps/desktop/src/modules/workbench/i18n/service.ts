import i18n from "./i18n-instance";
import type { I18nKey, WorkbenchLocale } from "./types";

// ponytail: workbench 翻译器 — createTranslator(locale) 返回 (key, options?) => string
export const createTranslator = (locale: WorkbenchLocale) => {
  const translate = i18n.getFixedT(locale);
  return (key: I18nKey, options?: Record<string, unknown>): string =>
    (options ? translate(key, options) : translate(key)) as string;
};

// ponytail: agent 面板兼容 API — 委托 i18next 单 namespace，签名与原 core/i18n.ts 一致
export const t = (key: I18nKey): string => i18n.t(key) as string;

export const formatMessage = (
  key: I18nKey,
  values: Readonly<Record<string, string | number>>,
): string => i18n.t(key, { ...values }) as string;

export const setLocale = (locale: WorkbenchLocale): void => {
  void i18n.changeLanguage(locale);
};

export const getLocale = (): WorkbenchLocale => i18n.language as WorkbenchLocale;
