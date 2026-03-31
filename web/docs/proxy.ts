import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  DEFAULT_DOCS_LOCALE,
  normalizeDocsLocale,
  resolveDocsLocaleFromAcceptLanguage
} from "@/lib/i18n";
import {
  DOCS_LOCALE_COOKIE_KEY,
  DOCS_LOCALE_HEADER_KEY
} from "@/lib/runtime-context";

const resolveRequestLocale = (request: NextRequest): string => {
  const queryLocale = normalizeDocsLocale(request.nextUrl.searchParams.get("locale"));
  if (queryLocale !== null) {
    return queryLocale;
  }

  const cookieLocale = normalizeDocsLocale(request.cookies.get(DOCS_LOCALE_COOKIE_KEY)?.value);
  if (cookieLocale !== null) {
    return cookieLocale;
  }

  const acceptLanguageLocale = resolveDocsLocaleFromAcceptLanguage(
    request.headers.get("accept-language")
  );
  if (acceptLanguageLocale !== null) {
    return acceptLanguageLocale;
  }

  return DEFAULT_DOCS_LOCALE;
};

export function proxy(request: NextRequest) {
  const locale = resolveRequestLocale(request);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(DOCS_LOCALE_HEADER_KEY, locale);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });

  if (request.cookies.get(DOCS_LOCALE_COOKIE_KEY)?.value !== locale) {
    response.cookies.set(DOCS_LOCALE_COOKIE_KEY, locale, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|.*\\..*).*)"]
};

