import {
  session as electronSessionApi,
  type Session,
  type WebContents
} from "electron";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FAVICON_CACHE_VERSION = 1 as const;
const FAVICON_CACHE_DIR_NAME = "favicons";
const FAVICON_CACHE_INDEX_FILE_NAME = "index.v1.json";
const FAVICON_MAX_BYTES = 1024 * 1024;

type FaviconCacheRecord = {
  readonly origin: string;
  readonly sourceUrl: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly updatedAt: string;
};

type FaviconCacheIndex = {
  readonly version: 1;
  readonly records: readonly FaviconCacheRecord[];
};

export type LoginManagerFaviconCache = {
  readonly queue: (
    origin: string,
    sourceUrl: string | null | undefined,
    electronSession?: Session
  ) => void;
  readonly urlForSnapshot: (
    origin: string,
    sourceUrl: string | null | undefined,
    electronSession?: Session
  ) => string | undefined;
  readonly clearInFlight: () => void;
};

const nowIso = (): string => new Date().toISOString();

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizeFaviconUrl = (
  value: unknown,
  origin?: string
): string | null => {
  const raw = normalizeString(value);
  if (raw === null) {
    return null;
  }
  try {
    const parsed = new URL(raw, origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch (_error) {
    return null;
  }
};

export const fallbackFaviconUrl = (origin: string): string | null => {
  try {
    const parsed = new URL(origin);
    parsed.pathname = "/favicon.ico";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch (_error) {
    return null;
  }
};

const faviconCacheDir = (storageRoot: string): string =>
  path.join(storageRoot, FAVICON_CACHE_DIR_NAME);

const faviconCacheIndexPath = (storageRoot: string): string =>
  path.join(faviconCacheDir(storageRoot), FAVICON_CACHE_INDEX_FILE_NAME);

const emptyFaviconCacheIndex = (): FaviconCacheIndex => ({
  version: FAVICON_CACHE_VERSION,
  records: []
});

const readFaviconCacheIndex = (storageRoot: string): FaviconCacheIndex => {
  try {
    const parsed = JSON.parse(
      readFileSync(faviconCacheIndexPath(storageRoot), "utf8")
    ) as Partial<FaviconCacheIndex>;
    if (parsed.version !== FAVICON_CACHE_VERSION || Array.isArray(parsed.records) === false) {
      return emptyFaviconCacheIndex();
    }
    return {
      version: FAVICON_CACHE_VERSION,
      records: parsed.records.filter((record): record is FaviconCacheRecord => (
        record !== null
        && typeof record === "object"
        && typeof record.origin === "string"
        && typeof record.sourceUrl === "string"
        && typeof record.fileName === "string"
        && typeof record.mimeType === "string"
        && typeof record.updatedAt === "string"
      ))
    };
  } catch (_error) {
    return emptyFaviconCacheIndex();
  }
};

const writeFaviconCacheIndex = (
  storageRoot: string,
  index: FaviconCacheIndex
): void => {
  mkdirSync(faviconCacheDir(storageRoot), { recursive: true });
  writeFileSync(
    faviconCacheIndexPath(storageRoot),
    JSON.stringify(index, null, 2),
    "utf8"
  );
};

const toFilePreviewUrl = (filePath: string, mimeType: string): string =>
  `lyra-file://preview?path=${encodeURIComponent(filePath)}&contentType=${encodeURIComponent(mimeType)}`;

const faviconFileNameFor = (origin: string): string =>
  `${createHash("sha256").update(origin).digest("hex").slice(0, 32)}.favicon`;

const cachedFaviconUrl = (
  storageRoot: string,
  index: FaviconCacheIndex,
  origin: string
): string | null => {
  const record = index.records.find((entry) => entry.origin === origin);
  if (record === undefined) {
    return null;
  }
  const filePath = path.join(faviconCacheDir(storageRoot), record.fileName);
  if (existsSync(filePath) === false) {
    return null;
  }
  return toFilePreviewUrl(filePath, record.mimeType);
};

const mimeTypeFromFaviconResponse = (
  sourceUrl: string,
  contentTypeHeader: string | null
): string | null => {
  const headerMimeType = contentTypeHeader
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (headerMimeType !== undefined && headerMimeType.startsWith("image/")) {
    return headerMimeType;
  }
  let extension = "";
  try {
    extension = path.extname(new URL(sourceUrl).pathname).toLowerCase();
  } catch (_error) {
    extension = "";
  }
  if (extension === ".ico" || extension === ".cur") return "image/x-icon";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".avif") return "image/avif";
  return null;
};

const fetchFaviconResponse = async (
  sourceUrl: string,
  electronSession?: Session
): Promise<Response> => {
  const requestInit: RequestInit = {
    redirect: "follow",
    headers: {
      Accept: "image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8"
    }
  };
  const sessionForFetch = electronSession ?? electronSessionApi.defaultSession;
  const sessionFetch = (sessionForFetch as { readonly fetch?: typeof fetch } | undefined)?.fetch;
  if (typeof sessionFetch === "function") {
    return await sessionFetch.call(sessionForFetch, sourceUrl, requestInit);
  }
  return await fetch(sourceUrl, requestInit);
};

export const readPageFaviconUrl = async (
  webContents: WebContents,
  origin: string
): Promise<string | null> => {
  const raw = await webContents.executeJavaScript(
    `(() => {
      const candidates = Array.from(document.querySelectorAll("link[rel][href]"))
        .map((link) => ({
          rel: String(link.getAttribute("rel") || "").toLowerCase(),
          href: String(link.getAttribute("href") || "")
        }))
        .filter((entry) =>
          entry.href.length > 0
          && (
            entry.rel.includes("icon")
            || entry.rel.includes("apple-touch-icon")
            || entry.rel.includes("mask-icon")
          )
        )
        .sort((left, right) => {
          const score = (entry) => {
            if (entry.rel.includes("shortcut icon")) return 0;
            if (entry.rel === "icon" || entry.rel.includes(" icon")) return 1;
            if (entry.rel.includes("apple-touch-icon")) return 2;
            return 3;
          };
          return score(left) - score(right);
        });
      const href = candidates[0]?.href || "/favicon.ico";
      try {
        return new URL(href, document.baseURI || window.location.href).toString();
      } catch (_error) {
        return href;
      }
    })()`,
    true
  ).catch(() => null);
  return normalizeFaviconUrl(raw, origin);
};

export const createLoginManagerFaviconCache = ({
  storageRoot,
  onCacheUpdated
}: {
  readonly storageRoot: string;
  readonly onCacheUpdated: () => void;
}): LoginManagerFaviconCache => {
  let faviconCacheIndex = readFaviconCacheIndex(storageRoot);
  const faviconCacheInFlight = new Set<string>();

  const saveFaviconCacheIndex = (): void => {
    writeFaviconCacheIndex(storageRoot, faviconCacheIndex);
  };

  const cacheFavicon = async (
    origin: string,
    sourceUrl: string,
    electronSession?: Session
  ): Promise<boolean> => {
    const response = await fetchFaviconResponse(sourceUrl, electronSession);
    if (response.ok === false) {
      return false;
    }
    const mimeType = mimeTypeFromFaviconResponse(
      response.url.trim().length > 0 ? response.url : sourceUrl,
      response.headers.get("content-type")
    );
    if (mimeType === null) {
      return false;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > FAVICON_MAX_BYTES) {
      return false;
    }
    const fileName = faviconFileNameFor(origin);
    mkdirSync(faviconCacheDir(storageRoot), { recursive: true });
    writeFileSync(path.join(faviconCacheDir(storageRoot), fileName), bytes);
    const record: FaviconCacheRecord = {
      origin,
      sourceUrl,
      fileName,
      mimeType,
      updatedAt: nowIso()
    };
    faviconCacheIndex = {
      version: FAVICON_CACHE_VERSION,
      records: [
        record,
        ...faviconCacheIndex.records.filter((entry) => entry.origin !== origin)
      ]
    };
    saveFaviconCacheIndex();
    return true;
  };

  const queue = (
    origin: string,
    sourceUrl: string | null | undefined,
    electronSession?: Session
  ): void => {
    const normalizedSourceUrl = normalizeFaviconUrl(sourceUrl, origin);
    if (normalizedSourceUrl === null) {
      return;
    }
    const existing = faviconCacheIndex.records.find((entry) => entry.origin === origin);
    if (
      existing !== undefined
      && existing.sourceUrl === normalizedSourceUrl
      && existsSync(path.join(faviconCacheDir(storageRoot), existing.fileName))
    ) {
      return;
    }
    const cacheKey = `${origin}\n${normalizedSourceUrl}`;
    if (faviconCacheInFlight.has(cacheKey)) {
      return;
    }
    faviconCacheInFlight.add(cacheKey);
    void cacheFavicon(origin, normalizedSourceUrl, electronSession)
      .then((cached) => {
        if (cached) {
          onCacheUpdated();
        }
      })
      .catch(() => undefined)
      .finally(() => {
        faviconCacheInFlight.delete(cacheKey);
      });
  };

  const urlForSnapshot = (
    origin: string,
    sourceUrl: string | null | undefined,
    electronSession?: Session
  ): string | undefined => {
    const cachedUrl = cachedFaviconUrl(storageRoot, faviconCacheIndex, origin);
    if (cachedUrl !== null) {
      return cachedUrl;
    }
    const normalizedSourceUrl = normalizeFaviconUrl(sourceUrl, origin)
      ?? fallbackFaviconUrl(origin);
    queue(origin, normalizedSourceUrl, electronSession);
    return normalizedSourceUrl ?? undefined;
  };

  return {
    queue,
    urlForSnapshot,
    clearInFlight: () => {
      faviconCacheInFlight.clear();
    }
  };
};
