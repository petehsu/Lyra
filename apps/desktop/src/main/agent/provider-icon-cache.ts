import { lookup } from "node:dns/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { BlockList, isIP } from "node:net";
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
const PROVIDER_ICON_HTML_MAX_BYTES = 512 * 1024;
const DEFAULT_NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_PUBLIC_REDIRECTS = 5;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const FAVICON_ACCEPT = "image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8";

const nonPublicAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
] as const) {
  nonPublicAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8]
] as const) {
  nonPublicAddresses.addSubnet(network, prefix, "ipv6");
}

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
  readonly scope?: "public-only";
};

type ProviderIconIndex = {
  readonly version: 1;
  readonly records: readonly ProviderIconRecord[];
  readonly failures: readonly ProviderIconFailure[];
};

export type ProviderIconCache = {
  readonly resolve: (
    baseUrl: string,
    options?: { readonly publicOnly?: boolean }
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
  now: Date,
  publicOnly: boolean
): boolean => {
  return index.failures.some((entry) =>
    entry.origin === origin
    && (publicOnly || entry.scope !== "public-only")
    && new Date(entry.expiresAt).getTime() > now.getTime()
  );
};

const fetchHtml = async (origin: string): Promise<{
  readonly html: string;
  readonly baseUrl: string;
} | null> => {
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
    return {
      html: await response.text(),
      baseUrl: origin
    };
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const normalizedHostname = (url: URL): string => {
  const raw = url.hostname.toLowerCase();
  const withoutBrackets =
    raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  return withoutBrackets.replace(/\.+$/u, "");
};

const mappedIpv4Address = (address: string): string | null => {
  const normalized = address.toLowerCase();
  if (!normalized.startsWith("::ffff:")) {
    return null;
  }
  const suffix = normalized.slice("::ffff:".length);
  if (isIP(suffix) === 4) {
    return suffix;
  }
  const parts = suffix.split(":");
  if (parts.length !== 2) {
    return null;
  }
  const high = Number.parseInt(parts[0] ?? "", 16);
  const low = Number.parseInt(parts[1] ?? "", 16);
  if (
    !Number.isInteger(high)
    || !Number.isInteger(low)
    || high < 0
    || high > 0xffff
    || low < 0
    || low > 0xffff
  ) {
    return null;
  }
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
};

const isPublicAddress = (address: string): boolean => {
  const mappedIpv4 = mappedIpv4Address(address);
  if (mappedIpv4 !== null) {
    return isPublicAddress(mappedIpv4);
  }
  const family = isIP(address);
  return family !== 0
    && !nonPublicAddresses.check(address, family === 6 ? "ipv6" : "ipv4");
};

const isPublicHttpUrlSyntax = (url: URL): boolean => {
  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || url.username.length > 0
    || url.password.length > 0
  ) {
    return false;
  }
  const hostname = normalizedHostname(url);
  if (hostname.length === 0) {
    return false;
  }
  if (isIP(hostname) !== 0) {
    return false;
  }
  return hostname.includes(".")
    && hostname !== "localhost"
    && !hostname.endsWith(".localhost")
    && !hostname.endsWith(".local")
    && !hostname.endsWith(".localdomain")
    && hostname !== "home.arpa"
    && !hostname.endsWith(".home.arpa")
    && !hostname.endsWith(".internal");
};

const resolvesOnlyToPublicAddresses = async (url: URL): Promise<boolean> => {
  const hostname = normalizedHostname(url);
  if (isIP(hostname) !== 0) {
    return isPublicAddress(hostname);
  }
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.length > 0
      && addresses.every((entry) => isPublicAddress(entry.address));
  } catch (_error) {
    return false;
  }
};

const cancelResponseBody = async (response: Response): Promise<void> => {
  await response.body?.cancel().catch(() => undefined);
};

const withPublicResponse = async <T>(
  initialUrl: string,
  init: RequestInit,
  consume: (response: Response) => Promise<T>
): Promise<T | null> => {
  let currentUrl: URL;
  try {
    currentUrl = new URL(initialUrl);
  } catch (_error) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    for (let redirectCount = 0; ; redirectCount += 1) {
      if (
        !isPublicHttpUrlSyntax(currentUrl)
        || !await resolvesOnlyToPublicAddresses(currentUrl)
      ) {
        return null;
      }
      const response = await fetch(currentUrl.href, {
        ...init,
        redirect: "manual",
        signal: controller.signal
      });
      if (!REDIRECT_STATUS_CODES.has(response.status)) {
        return await consume(response);
      }

      const location = response.headers.get("location");
      if (location === null || redirectCount >= MAX_PUBLIC_REDIRECTS) {
        await cancelResponseBody(response);
        return null;
      }
      try {
        currentUrl = new URL(location, currentUrl);
      } catch (_error) {
        await cancelResponseBody(response);
        return null;
      }
      await cancelResponseBody(response);
    }
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const readLimitedResponseBytes = async (
  response: Response,
  maxBytes: number
): Promise<Buffer | null> => {
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelResponseBody(response);
    return null;
  }
  if (response.body === null) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length <= maxBytes ? bytes : null;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        return Buffer.concat(chunks, totalBytes);
      }
      const bytes = Buffer.from(chunk.value);
      totalBytes += bytes.length;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(bytes);
    }
  } catch (_error) {
    await reader.cancel().catch(() => undefined);
    return null;
  }
};

const fetchPublicHtml = async (origin: string): Promise<{
  readonly html: string;
  readonly baseUrl: string;
} | null> => {
  return await withPublicResponse(
    origin,
    {
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8"
      }
    },
    async (response) => {
      if (!response.ok) {
        await cancelResponseBody(response);
        return null;
      }
      const bytes = await readLimitedResponseBytes(
        response,
        PROVIDER_ICON_HTML_MAX_BYTES
      );
      return bytes === null
        ? null
        : {
            html: bytes.toString("utf8"),
            baseUrl: response.url.trim().length > 0 ? response.url : origin
          };
    }
  );
};

const fetchPublicIcon = async (
  sourceUrl: string
): Promise<{ readonly mimeType: string; readonly bytes: Buffer } | null> =>
  await withPublicResponse(
    sourceUrl,
    { headers: { Accept: FAVICON_ACCEPT } },
    async (response) => {
      if (!response.ok) {
        await cancelResponseBody(response);
        return null;
      }
      const mimeType = mimeTypeFromFaviconResponse(
        response.url.trim().length > 0 ? response.url : sourceUrl,
        response.headers.get("content-type")
      );
      if (mimeType === null) {
        await cancelResponseBody(response);
        return null;
      }
      const bytes = await readLimitedResponseBytes(response, PROVIDER_ICON_MAX_BYTES);
      return bytes === null ? null : { mimeType, bytes };
    }
  );

const persistIcon = async (
  storageRoot: string,
  origin: string,
  sourceUrl: string,
  publicOnly: boolean
): Promise<string | null> => {
  let mimeType: string;
  let bytes: Buffer;
  if (publicOnly) {
    const icon = await fetchPublicIcon(sourceUrl);
    if (icon === null) {
      return null;
    }
    ({ mimeType, bytes } = icon);
  } else {
    const response = await fetchFaviconResponse(sourceUrl);
    if (!response.ok) {
      return null;
    }
    const resolvedMimeType = mimeTypeFromFaviconResponse(
      response.url.trim().length > 0 ? response.url : sourceUrl,
      response.headers.get("content-type")
    );
    if (resolvedMimeType === null) {
      return null;
    }
    mimeType = resolvedMimeType;
    bytes = Buffer.from(await response.arrayBuffer());
  }
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
  records: failure.scope === "public-only"
    ? index.records
    : index.records.filter((entry) => entry.origin !== failure.origin),
  failures: [
    failure,
    ...index.failures.filter((entry) =>
      entry.origin !== failure.origin || entry.scope !== failure.scope
    )
  ]
});

export const createProviderIconCache = ({
  storageRoot,
  negativeTtlMs = DEFAULT_NEGATIVE_TTL_MS
}: {
  readonly storageRoot: string;
  readonly negativeTtlMs?: number;
}): ProviderIconCache => {
  let index = readIndex(storageRoot);
  const inFlight = new Map<string, Promise<{ readonly iconUrl: string | null }>>();

  const resolveUncached = async (
    origin: string,
    publicOnly: boolean
  ): Promise<{ readonly iconUrl: string | null }> => {
    try {
      const page = publicOnly ? await fetchPublicHtml(origin) : await fetchHtml(origin);
      const sourceUrl =
        (page !== null ? parseIconLinksFromHtml(page.html, page.baseUrl) : null)
        ?? fallbackFaviconUrl(origin);
      if (sourceUrl === null) {
        index = upsertFailure(index, {
          origin,
          expiresAt: new Date(Date.now() + negativeTtlMs).toISOString(),
          ...(publicOnly ? { scope: "public-only" as const } : {})
        });
        writeIndex(storageRoot, index);
        return { iconUrl: null };
      }

      const previewUrl = await persistIcon(storageRoot, origin, sourceUrl, publicOnly);
      if (previewUrl === null) {
        index = upsertFailure(index, {
          origin,
          expiresAt: new Date(Date.now() + negativeTtlMs).toISOString(),
          ...(publicOnly ? { scope: "public-only" as const } : {})
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
        expiresAt: new Date(Date.now() + negativeTtlMs).toISOString(),
        ...(publicOnly ? { scope: "public-only" as const } : {})
      });
      writeIndex(storageRoot, index);
      return { iconUrl: null };
    }
  };

  const resolve = async (
    baseUrl: string,
    options: { readonly publicOnly?: boolean } = {}
  ): Promise<{ readonly iconUrl: string | null }> => {
    const origin = originFromBaseUrl(baseUrl);
    const publicOnly = options.publicOnly === true;
    if (origin === null) {
      return { iconUrl: null };
    }
    if (publicOnly) {
      try {
        if (!isPublicHttpUrlSyntax(new URL(origin))) {
          return { iconUrl: null };
        }
      } catch (_error) {
        return { iconUrl: null };
      }
    }

    const cached = cachedPreviewUrl(storageRoot, index, origin);
    if (cached !== null) {
      return { iconUrl: cached };
    }
    if (isNegativeFresh(index, origin, new Date(), publicOnly)) {
      return { iconUrl: null };
    }

    const cacheKey = `${publicOnly ? "public" : "default"}:${origin}`;
    const pending = inFlight.get(cacheKey);
    if (pending !== undefined) {
      return pending;
    }
    const started = resolveUncached(origin, publicOnly).finally(() => {
      if (inFlight.get(cacheKey) === started) {
        inFlight.delete(cacheKey);
      }
    });
    inFlight.set(cacheKey, started);
    return started;
  };

  return {
    resolve,
    dispose: () => {
      inFlight.clear();
    }
  };
};
