import { useLayoutEffect, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

import i18n, { changeI18nLocale } from "./i18n-instance";
import { useWorkbenchLocaleSnapshot } from "./locale-state";

const RTL_LANGUAGE_PREFIXES = new Set(["ar", "fa", "he", "ur"]);

const textDirectionForLocale = (locale: string): "ltr" | "rtl" =>
  RTL_LANGUAGE_PREFIXES.has(locale.split("-")[0]?.toLowerCase() ?? "")
    ? "rtl"
    : "ltr";

export function WorkbenchI18nProvider({
  children
}: {
  readonly children: ReactNode;
}) {
  const { locale, revision } = useWorkbenchLocaleSnapshot();

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = textDirectionForLocale(locale);
    void changeI18nLocale(locale);
  }, [locale, revision]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
