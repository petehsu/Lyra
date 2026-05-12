import type { Session } from "electron";

const HANDOFF_SUPPORTED_PROTOCOLS: ReadonlySet<string> = new Set([
  "http:",
  "https:"
]);

export const shouldHandoffBrowserDownload = (url: string): boolean => {
  try {
    return HANDOFF_SUPPORTED_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
};

const escapeCookieValue = (value: string): string => value.replace(/[\r\n]+/gu, "").trim();

export const buildCookieHeaderValue = (
  cookies: ReadonlyArray<{ readonly name?: string; readonly value?: string }>
): string | undefined => {
  const parts: string[] = [];
  for (const cookie of cookies) {
    const name = typeof cookie.name === "string" ? cookie.name.trim() : "";
    if (name.length === 0) {
      continue;
    }
    const value = typeof cookie.value === "string" ? escapeCookieValue(cookie.value) : "";
    parts.push(`${name}=${value}`);
  }
  return parts.length === 0 ? undefined : parts.join("; ");
};

export type BrowserDownloadHeaderSources = {
  readonly session: Pick<Session, "cookies"> | undefined;
  readonly url: string;
  readonly referrerHint?: string | undefined;
  readonly userAgentHint?: string | undefined;
};

export const collectBrowserDownloadHeaders = async (
  sources: BrowserDownloadHeaderSources
): Promise<Readonly<Record<string, string>>> => {
  const headers: Record<string, string> = {};

  const referrer = typeof sources.referrerHint === "string" ? sources.referrerHint.trim() : "";
  if (referrer.length > 0) {
    headers.Referer = referrer;
  }

  const userAgent = typeof sources.userAgentHint === "string" ? sources.userAgentHint.trim() : "";
  if (userAgent.length > 0) {
    headers["User-Agent"] = userAgent;
  }

  const session = sources.session;
  if (session !== undefined) {
    try {
      const cookies = await session.cookies.get({ url: sources.url });
      const cookieHeader = buildCookieHeaderValue(cookies);
      if (cookieHeader !== undefined) {
        headers.Cookie = cookieHeader;
      }
    } catch {
      // Cookie retrieval is best-effort. Missing cookies must not block handoff.
    }
  }

  return headers;
};
