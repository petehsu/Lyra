import { enUS } from "./en-US";
import { zhCN } from "./zh-CN";
import type { DownloadsMessages } from "../types";

export type { DownloadsMessages };

const CATALOGS: Readonly<Record<string, DownloadsMessages>> = {
  "en-US": enUS,
  "zh-CN": zhCN
};

const canonicalize = (locale: string): string | null => {
  const trimmed = locale.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    return Intl.getCanonicalLocales(trimmed)[0] ?? null;
  } catch {
    return null;
  }
};

const primaryLanguage = (canonical: string): string =>
  canonical.split("-")[0]?.toLowerCase() ?? canonical.toLowerCase();

export const resolveMessages = (locale: string): DownloadsMessages => {
  const canonical = canonicalize(locale);
  if (canonical !== null) {
    const exact = CATALOGS[canonical];
    if (exact !== undefined) {
      return exact;
    }
    const language = primaryLanguage(canonical);
    for (const [id, messages] of Object.entries(CATALOGS)) {
      if (primaryLanguage(id) === language) {
        return messages;
      }
    }
  }
  return enUS;
};
