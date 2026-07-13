import i18n from "./i18n-instance";
import { getWorkbenchLocale, setWorkbenchLocale } from "./locale-state";
import type { I18nKey, WorkbenchLocale } from "./types";

// ponytail: workbench 翻译器 — createTranslator(locale) 返回 (key, options?) => string
export const createTranslator = (locale: WorkbenchLocale) => {
  const translate = i18n.getFixedT(locale);
  return (key: I18nKey, options?: Record<string, unknown>): string =>
    (options ? translate(key, options) : translate(key)) as string;
};

// Imperative translation is retained for non-React services. React state remains
// in locale-state.ts, so this function never treats i18next.language as authority.
export const t = (key: I18nKey): string =>
  i18n.getFixedT(getWorkbenchLocale())(key) as string;

export const formatMessage = (
  key: I18nKey,
  values: Readonly<Record<string, string | number>>,
): string => i18n.getFixedT(getWorkbenchLocale())(key, { ...values }) as string;

export const setLocale = (locale: WorkbenchLocale): void => {
  setWorkbenchLocale(locale);
};

export const getLocale = (): WorkbenchLocale => getWorkbenchLocale();
