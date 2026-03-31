import { cookies, headers } from "next/headers";

import {
  DEFAULT_DOCS_LOCALE,
  type DocsLocale,
  normalizeDocsLocale,
  resolveDocsLocaleFromAcceptLanguage
} from "./i18n";

export const DOCS_LOCALE_COOKIE_KEY = "lyra_docs_locale";
export const DOCS_LOCALE_HEADER_KEY = "x-lyra-docs-locale";

export const resolveServerLocale = async (): Promise<DocsLocale> => {
  const requestHeaders = await headers();
  const requestCookies = await cookies();

  const fromHeader = normalizeDocsLocale(requestHeaders.get(DOCS_LOCALE_HEADER_KEY));
  if (fromHeader !== null) {
    return fromHeader;
  }

  const fromCookie = normalizeDocsLocale(requestCookies.get(DOCS_LOCALE_COOKIE_KEY)?.value);
  if (fromCookie !== null) {
    return fromCookie;
  }

  const fromAcceptLanguage = resolveDocsLocaleFromAcceptLanguage(
    requestHeaders.get("accept-language")
  );
  if (fromAcceptLanguage !== null) {
    return fromAcceptLanguage;
  }

  return DEFAULT_DOCS_LOCALE;
};

