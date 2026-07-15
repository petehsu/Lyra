import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  fallbackFaviconUrl,
  fetchFaviconResponse,
  faviconFileNameFor,
  mimeTypeFromFaviconResponse,
  parseIconLinksFromHtml,
  toFilePreviewUrl
} from "../login-manager/favicon-cache";

// Provider (custom OpenAI-compatible endpoint) icon resolver.
// Given a user-supplied baseUrl, fetch the site HTML, parse the real
// <link rel="icon"> declaration (falling back to /favicon.ico), download the
// bytes, and cache to disk. Keeps a positive cache (origin -> file) and a
// negative cache (origin -> expiry) so a site with no usable icon is not
// retried on every render. Reuses favicon-cache primitives so the on-disk
// format and fetch logic match the login-manager favicon cache.
// ponytail: global fetch (no Electron session) — provider icons need no
// cookies; upgrade path is session.fetch if a provider ever requires auth
// cookies to serve its favicon.

const PROVIDER_ICON_CACHE_VERSION = 1 as const;
const PROVIDER_ICON_DIR_NAME = "provider-icons";
const PROVIDER_ICON_INDEX_FILE = "index.v1.json";
const PROVIDER_ICON_MAX_BYTES = 1024 * 1024;
const DEFAULT_NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

type ProviderIconRecord = {
  readonly origin: string;
  readonly sourceUrl: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly updatedAt: string;
};

type ProviderIconFailure = {
  readonly origin: string;
  readonly expiresAt: string;
};

type ProviderIconIndex = {
  readonly version: 1;
  readonly records: readonly ProviderIconRecord[];
  readonly failures: readonly ProviderIconFailure[];
};

export type ProviderIconCache = {
  readonly resolve: (
    baseUrl: string
  ) => Promise<{ readonly iconUrl: string | null }>;
  readonly dispose: () => void;
};

const nowIso = (): string => new Date().toISOString();

export const providerIconCacheDir = (storageRoot: string): string =>
  path.join(storageRoot, PROVIDER_ICON_DIR_NAME);

const providerIconIndexPath = (storageRoot: string): string =>
  path.join(providerIconCacheDir(storageRoot), PROVIDER_ICON_INDEX_FILE);

const emptyIndex = (): ProviderIconIndex => ({
  version: PROVIDER_ICON_CACHE_VERSION,
  records: [],
  failures: []
});

const readIndex = (storageRoot: string): ProviderIconIndex => {
  try {
    const parsed = JSON.parse(
      readFileSync(providerIconIndexPath(storageRoot), "utf8")
    ) as Partial<ProviderIconIndex>;
    if (parsed.version !== PROVIDER_ICON_CACHE_VERSION) {
      return emptyIndex();
    }
    return {
      version: PROVIDER_ICON_CACHE_VERSION,
      records: Array.isArray(parsed.records) ? parsed.records : [],
      failures: Array.isArray(parsed.failures) ? parsed.failures : []
    };
  } catch (_error) {
    return emptyIndex();
  }
};

const writeIndex = (storageRoot: string, index: ProviderIconIndex): void => {
  mkdirSync(providerIconCacheDir(storageRoot), { recursive: true });
  writeFileSync(
    providerIconIndexPath(storageRoot),
    JSON.stringify(index, null, 2),
    "utf8"
  );
};

const originFromBaseUrl = (baseUrl: string): string | null => {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const withScheme = trimmed.includes("://")
    ? trimmed
    : `${
        trimmed.toLowerCase().startsWith("localhost") || trimmed.startsWith("127.")
          ? "http"
          : "https"
      }://${trimmed}`;
  try {
    return new URL(withScheme).origin;
  } catch (_error) {
    return null;
  }
};

const cachedPreviewUrl = (
  storageRoot: string,
  index: ProviderIconIndex,
  origin: string
): string | null => {
  const record = index.records.find((entry) => entry.origin === origin);
  if (record === undefined) {
    return null;
  }
  const filePath = path.join(providerIconCacheDir(storageRoot), record.fileName);
  if (!existsSync(filePath)) {
    return null;
  }
  return toFilePreviewUrl(filePath, record.mimeType);
};

const isNegativeFresh = (
  index: ProviderIconIndex,
  origin: string,
  now: Date
): boolean => {
  const failure = index.failures.find((entry) => entry.origin === origin);
  if (failure === undefined) {
    return false;
  }
  return new Date(failure.expiresAt).getTime() > now.getTime();
};

const fetchHtml = async (origin: string): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(origin, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8"
      }
    });
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const persistIcon = async (
  storageRoot: string,
  origin: string,
  sourceUrl: string
): Promise<string | null> => {
  const response = await fetchFaviconResponse(sourceUrl);
  if (!response.ok) {
    return null;
  }
  const mimeType = mimeTypeFromFaviconResponse(
    response.url.trim().length > 0 ? response.url : sourceUrl,
    response.headers.get("content-type")
  );
  if (mimeType === null) {
    return null;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > PROVIDER_ICON_MAX_BYTES) {
    return null;
  }
  const fileName = faviconFileNameFor(origin);
  mkdirSync(providerIconCacheDir(storageRoot), { recursive: true });
  writeFileSync(path.join(providerIconCacheDir(storageRoot), fileName), bytes);
  return toFilePreviewUrl(path.join(providerIconCacheDir(storageRoot), fileName), mimeType);
};

const upsertRecord = (
  index: ProviderIconIndex,
  record: ProviderIconRecord
): ProviderIconIndex => ({
  version: index.version,
  records: [record, ...index.records.filter((entry) => entry.origin !== record.origin)],
  failures: index.failures.filter((entry) => entry.origin !== record.origin)
});

const upsertFailure = (
  index: ProviderIconIndex,
  failure: ProviderIconFailure
): ProviderIconIndex => ({
  version: index.version,
  records: index.records.filter((entry) => entry.origin !== failure.origin),
  failures: [failure, ...index.failures.filter((entry) => entry.origin !== failure.origin)]
});

export const createProviderIconCache = ({
  storageRoot,
  negativeTtlMs = DEFAULT_NEGATIVE_TTL_MS
}: {
  readonly storageRoot: string;
  readonly negativeTtlMs?: number;
}): ProviderIconCache => {
  let index = readIndex(storageRoot);
  const inFlight = new Set<string>();

  const resolve = async (
    baseUrl: string
  ): Promise<{ readonly iconUrl: string | null }> => {
    const origin = originFromBaseUrl(baseUrl);
    if (origin === null) {
      return { iconUrl: null };
    }

    const cached = cachedPreviewUrl(storageRoot, index, origin);
    if (cached !== null) {
      return { iconUrl: cached };
    }
    if (isNegativeFresh(index, origin, new Date())) {
      return { iconUrl: null };
    }
    if (inFlight.has(origin)) {
      return { iconUrl: null };
    }

    inFlight.add(origin);
    try {
      const html = await fetchHtml(origin);
      const sourceUrl =
        (html !== null ? parseIconLinksFromHtml(html, origin) : null)
        ?? fallbackFaviconUrl(origin);
      if (sourceUrl === null) {
        index = upsertFailure(index, {
          origin,
          expiresAt: new Date(Date.now() + negativeTtlMs).toISOString()
        });
        writeIndex(storageRoot, index);
        return { iconUrl: null };
      }

      const previewUrl = await persistIcon(storageRoot, origin, sourceUrl);
      if (previewUrl === null) {
        index = upsertFailure(index, {
          origin,
          expiresAt: new Date(Date.now() + negativeTtlMs).toISOString()
        });
        writeIndex(storageRoot, index);
        return { iconUrl: null };
      }

      const fileName = faviconFileNameFor(origin);
      const mimeType = previewUrl.split("contentType=")[1] ?? "image/png";
      index = upsertRecord(index, {
        origin,
        sourceUrl,
        fileName,
        mimeType: decodeURIComponent(mimeType),
        updatedAt: nowIso()
      });
      writeIndex(storageRoot, index);
      return { iconUrl: previewUrl };
    } catch (_error) {
      index = upsertFailure(index, {
        origin,
        expiresAt: new Date(Date.now() + negativeTtlMs).toISOString()
      });
      writeIndex(storageRoot, index);
      return { iconUrl: null };
    } finally {
      inFlight.delete(origin);
    }
  };

  return {
    resolve,
    dispose: () => {
      inFlight.clear();
    }
  };
};