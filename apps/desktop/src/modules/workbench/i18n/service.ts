import { WORKBENCH_DICTIONARIES } from "./config";
import type { I18nKey, WorkbenchDictionary, WorkbenchLocale } from "./types";

const FALLBACK_LOCALE: WorkbenchLocale = "en-US";

const resolveDictionary = (locale: WorkbenchLocale): WorkbenchDictionary =>
  WORKBENCH_DICTIONARIES[locale] ?? WORKBENCH_DICTIONARIES[FALLBACK_LOCALE];

export const createTranslator = (locale: WorkbenchLocale) => {
  const dictionary = resolveDictionary(locale);

  return (key: I18nKey): string => dictionary[key] ?? WORKBENCH_DICTIONARIES[FALLBACK_LOCALE][key];
};
