import { createHash, verify } from "node:crypto";

import { EN_US_DICTIONARY } from "../apps/desktop/src/shared/i18n/en-US";
import {
  LANGUAGE_PACK_CATALOG_SCHEMA_VERSION,
  NATIVE_CONTEXT_MENU_EN_US_TRANSLATIONS,
  OFFICIAL_LANGUAGE_PACKS_API_URL,
  OFFICIAL_LANGUAGE_PACKS_PUBLIC_KEY,
  OFFICIAL_LANGUAGE_PACKS_RELEASE_URL,
  REQUIRED_OFFICIAL_LANGUAGE_PACK_LOCALES,
  type OfficialLanguagePackCatalog
} from "../apps/desktop/src/shared/language-packs";

const source: Readonly<Record<string, string>> = {
  ...EN_US_DICTIONARY,
  ...NATIVE_CONTEXT_MENU_EN_US_TRANSLATIONS
};
const stableEntries = (value: Readonly<Record<string, string>>) =>
  Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
const sha256 = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");
const keysetHash = sha256(stableEntries(source).map(([key]) => key).join("\n"));
const sourceContentHash = sha256(JSON.stringify(stableEntries(source)));
const releaseUrl = `${OFFICIAL_LANGUAGE_PACKS_RELEASE_URL}/source-${sourceContentHash}`;
const releaseApiUrl = `${OFFICIAL_LANGUAGE_PACKS_API_URL}/tags/source-${sourceContentHash}`;
const releaseAssetApiPrefix = `${OFFICIAL_LANGUAGE_PACKS_API_URL}/assets/`;
const assetPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u;
const fetchAttempts = process.env.CI === "true" ? 20 : 1;
const retryDelayMs = 15_000;

const wait = async (durationMs: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, durationMs));

let releaseAssetUrlsPromise: Promise<ReadonlyMap<string, string>> | null = null;

const readReleaseAssetUrls = (): Promise<ReadonlyMap<string, string>> => {
  releaseAssetUrlsPromise ??= fetch(releaseApiUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Lyra"
    },
    signal: AbortSignal.timeout(30_000)
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`release API is unavailable (${response.status})`);
    }
    const parsed = await response.json() as { readonly assets?: readonly unknown[] };
    const urls = new Map<string, string>();
    for (const candidate of parsed.assets ?? []) {
      if (typeof candidate !== "object" || candidate === null) {
        continue;
      }
      const value = candidate as { readonly name?: unknown; readonly url?: unknown };
      if (typeof value.name === "string" && assetPattern.test(value.name)
        && typeof value.url === "string" && value.url.startsWith(releaseAssetApiPrefix)) {
        urls.set(value.name, value.url);
      }
    }
    return urls;
  }).catch((error: unknown) => {
    releaseAssetUrlsPromise = null;
    throw error;
  });
  return releaseAssetUrlsPromise;
};

const fetchFromReleaseApi = async (asset: string): Promise<Buffer> => {
  const url = (await readReleaseAssetUrls()).get(asset);
  if (url === undefined) {
    throw new Error(`release API is missing ${asset}`);
  }
  const response = await fetch(url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "Lyra"
    },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) {
    throw new Error(`release asset API failed (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
};

const fetchBytes = async (asset: string): Promise<Buffer> => {
  if (!assetPattern.test(asset)) {
    throw new Error(`invalid release asset name: ${asset}`);
  }
  let lastStatus = 0;
  for (let attempt = 1; attempt <= fetchAttempts; attempt += 1) {
    try {
      return await fetchFromReleaseApi(asset);
    } catch (apiError) {
      try {
        const response = await fetch(`${releaseUrl}/${encodeURIComponent(asset)}`, {
          signal: AbortSignal.timeout(30_000)
        });
        if (response.ok) {
          return Buffer.from(await response.arrayBuffer());
        }
        lastStatus = response.status;
      } catch {
        lastStatus = 0;
      }
      if (attempt === fetchAttempts) {
        throw apiError;
      }
    }
    if (attempt < fetchAttempts) {
      console.log(
        `[language-packs] waiting for source release (${asset}: ${lastStatus}, attempt ${attempt}/${fetchAttempts})`
      );
      await wait(retryDelayMs);
    }
  }
  throw new Error(`${asset} is unavailable (${lastStatus})`);
};

const verifyReleaseSignature = (payload: Buffer, signaturePayload: Buffer): void => {
  const signature = Buffer.from(signaturePayload.toString("utf8").trim(), "base64");
  if (
    signature.length !== 64
    || !verify(null, payload, OFFICIAL_LANGUAGE_PACKS_PUBLIC_KEY, signature)
  ) {
    throw new Error("official language-pack signature verification failed");
  }
};

const interpolationTokens = (value: string): readonly string[] =>
  Array.from(value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu), (match) => match[1]!).sort();

const main = async (): Promise<void> => {
  const [rawCatalog, rawCatalogSignature] = await Promise.all([
    fetchBytes("catalog.json"),
    fetchBytes("catalog.json.sig")
  ]);
  verifyReleaseSignature(rawCatalog, rawCatalogSignature);
  const catalog = JSON.parse(rawCatalog.toString("utf8")) as OfficialLanguagePackCatalog;
  if (
    catalog.schemaVersion !== LANGUAGE_PACK_CATALOG_SCHEMA_VERSION
    || !Array.isArray(catalog.packs)
  ) {
    throw new Error("official language-pack catalog has an unsupported schema");
  }

  const locales = new Set(catalog.packs.map((pack) => pack.locale));
  for (const requiredLocale of REQUIRED_OFFICIAL_LANGUAGE_PACK_LOCALES) {
    if (!locales.has(requiredLocale)) {
      throw new Error(`official language-pack release is missing ${requiredLocale}`);
    }
  }

  const expectedKeys = new Set(Object.keys(source));
  for (const pack of catalog.packs) {
    if (pack.sourceContentHash !== sourceContentHash || pack.keysetHash !== keysetHash) {
      throw new Error(`${pack.locale} was built from a different Lyra translation source`);
    }
    const [rawBundle, rawBundleSignature] = await Promise.all([
      fetchBytes(pack.asset),
      fetchBytes(pack.signature)
    ]);
    verifyReleaseSignature(rawBundle, rawBundleSignature);
    if (sha256(rawBundle) !== pack.sha256) {
      throw new Error(`${pack.locale} SHA-256 verification failed`);
    }
    const bundle = JSON.parse(rawBundle.toString("utf8")) as Record<string, unknown>;
    const keys = Object.keys(bundle);
    if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) {
      throw new Error(`${pack.locale} keyset does not match Lyra`);
    }
    for (const [key, sourceValue] of Object.entries(source)) {
      const translated = bundle[key];
      if (typeof translated !== "string") {
        throw new Error(`${pack.locale} is missing ${key}`);
      }
      if (interpolationTokens(sourceValue).join(",") !== interpolationTokens(translated).join(",")) {
        throw new Error(`${pack.locale} interpolation mismatch for ${key}`);
      }
    }
  }

  console.log(
    `[language-packs] verified signed source release ${sourceContentHash} (${catalog.packs.length} packs)`
  );
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
