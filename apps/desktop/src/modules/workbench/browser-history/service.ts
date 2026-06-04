import { readWorkbenchStateSync, writeWorkbenchStateSync } from "../state-storage";

export type BrowserHistoryEntry = {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly faviconUrl?: string;
  readonly visitedAt: string;
  readonly visitCount: number;
};

type BrowserHistoryState = {
  readonly version: 1;
  readonly entries: readonly BrowserHistoryEntry[];
};

type BrowserHistoryRecordRequest = {
  readonly url: string;
  readonly title?: string | null;
  readonly faviconUrl?: string | null;
  readonly visitedAt?: string;
  readonly countVisit?: boolean;
};

const BROWSER_HISTORY_STATE_KEY = "browser-history" as const;
const BROWSER_HISTORY_LIMIT = 500;

const normalize = (value: string): string => value.trim().toLocaleLowerCase();

export const toRecordableBrowserHistoryUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.href;
  } catch (_error) {
    return null;
  }
};

const toFallbackTitle = (url: string): string => {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname}${path}`;
  } catch (_error) {
    return url;
  }
};

const sanitizeEntry = (value: unknown): BrowserHistoryEntry | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Partial<BrowserHistoryEntry>;
  if (typeof candidate.url !== "string") {
    return null;
  }
  const url = toRecordableBrowserHistoryUrl(candidate.url);
  if (url === null) {
    return null;
  }
  const title =
    typeof candidate.title === "string" && candidate.title.trim().length > 0
      ? candidate.title.trim()
      : toFallbackTitle(url);
  const visitedAt =
    typeof candidate.visitedAt === "string" && candidate.visitedAt.trim().length > 0
      ? candidate.visitedAt.trim()
      : new Date().toISOString();
  const visitCount =
    typeof candidate.visitCount === "number" && Number.isFinite(candidate.visitCount)
      ? Math.max(1, Math.floor(candidate.visitCount))
      : 1;
  const faviconUrl =
    typeof candidate.faviconUrl === "string" && candidate.faviconUrl.trim().length > 0
      ? candidate.faviconUrl.trim()
      : undefined;

  return {
    id: url,
    url,
    title,
    ...(faviconUrl === undefined ? {} : { faviconUrl }),
    visitedAt,
    visitCount
  };
};

const parseBrowserHistoryState = (raw: string | null): BrowserHistoryState => {
  if (raw === null) {
    return {
      version: 1,
      entries: []
    };
  }

  try {
    const parsed = JSON.parse(raw) as { readonly entries?: unknown };
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.map(sanitizeEntry).filter((entry): entry is BrowserHistoryEntry => entry !== null)
      : [];
    return {
      version: 1,
      entries: entries.slice(0, BROWSER_HISTORY_LIMIT)
    };
  } catch (_error) {
    return {
      version: 1,
      entries: []
    };
  }
};

const writeBrowserHistoryState = (state: BrowserHistoryState): void => {
  writeWorkbenchStateSync(BROWSER_HISTORY_STATE_KEY, JSON.stringify(state));
};

export const readBrowserHistoryEntries = (): readonly BrowserHistoryEntry[] =>
  parseBrowserHistoryState(readWorkbenchStateSync(BROWSER_HISTORY_STATE_KEY)).entries;

export const recordBrowserHistoryVisit = ({
  url,
  title,
  faviconUrl,
  visitedAt = new Date().toISOString(),
  countVisit = true
}: BrowserHistoryRecordRequest): BrowserHistoryEntry | null => {
  const normalizedUrl = toRecordableBrowserHistoryUrl(url);
  if (normalizedUrl === null) {
    return null;
  }

  const entries = [...readBrowserHistoryEntries()];
  const existingIndex = entries.findIndex((entry) => entry.url === normalizedUrl);
  const nextTitle = title?.trim() || toFallbackTitle(normalizedUrl);
  const nextFaviconUrl = faviconUrl?.trim() || undefined;
  const existing = existingIndex >= 0 ? entries[existingIndex] : undefined;
  const nextEntry: BrowserHistoryEntry = {
    id: normalizedUrl,
    url: normalizedUrl,
    title: nextTitle,
    ...(nextFaviconUrl === undefined ? {} : { faviconUrl: nextFaviconUrl }),
    visitedAt: countVisit || existing === undefined ? visitedAt : existing.visitedAt,
    visitCount: countVisit ? (existing?.visitCount ?? 0) + 1 : existing?.visitCount ?? 1
  };

  if (existingIndex >= 0) {
    entries.splice(existingIndex, 1);
  }
  entries.unshift(nextEntry);
  writeBrowserHistoryState({
    version: 1,
    entries: entries.slice(0, BROWSER_HISTORY_LIMIT)
  });
  return nextEntry;
};

export const filterBrowserHistoryEntries = (
  entries: readonly BrowserHistoryEntry[],
  query: string
): readonly BrowserHistoryEntry[] => {
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length === 0) {
    return entries;
  }
  return entries.filter((entry) =>
    normalize([entry.title, entry.url].join(" ")).includes(normalizedQuery)
  );
};
