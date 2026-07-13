import i18n from "./i18n-instance";

export const uiPackI18nNamespace = (packId: string): string => `ui-pack:${packId}`;

export const registerUiPackI18nResources = (
  packId: string,
  bundles: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined
): (() => void) => {
  if (bundles === undefined) {
    return () => {};
  }

  const namespace = uiPackI18nNamespace(packId);
  const locales: string[] = [];
  for (const [locale, bundle] of Object.entries(bundles)) {
    i18n.addResourceBundle(locale, namespace, bundle, true, false);
    locales.push(locale);
  }

  return () => {
    for (const locale of locales) {
      i18n.removeResourceBundle(locale, namespace);
    }
  };
};
