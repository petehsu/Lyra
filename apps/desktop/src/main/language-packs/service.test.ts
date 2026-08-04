import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      },
      removeHandler: (channel: string) => {
        handlers.delete(channel);
      }
    }
  };
});

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: electronMocks.ipcMain
}));

import { LYRA_CHANNELS } from "../../shared/desktop-bridge";
import { EN_US_DICTIONARY } from "../../shared/i18n/en-US";
import {
  LANGUAGE_PACK_CATALOG_SCHEMA_VERSION,
  NATIVE_CONTEXT_MENU_EN_US_TRANSLATIONS
} from "../../shared/language-packs";
import {
  createLanguagePacksIpcBridge,
  languagePackContentHash,
  languagePackKeysetHash,
  validateComponentLanguagePackBundle,
  validateOfficialLanguagePackBundle
} from "./service";

type AssetMap = Readonly<Record<string, Buffer>>;

const source = {
  ...EN_US_DICTIONARY,
  ...NATIVE_CONTEXT_MENU_EN_US_TRANSLATIONS
};
const translatedBundle = Object.fromEntries(
  Object.entries(source).map(([key, value]) => [key, `[ja] ${value}`])
);

const responseFor = (assets: AssetMap, url: string) => {
  const asset = assets[url];
  if (asset === undefined) {
    return {
      ok: false,
      status: 404,
      text: async () => "",
      arrayBuffer: async () => new ArrayBuffer(0)
    };
  }
  return {
    ok: true,
    status: 200,
    text: async () => asset.toString("utf8"),
    arrayBuffer: async () =>
      asset.buffer.slice(asset.byteOffset, asset.byteOffset + asset.byteLength) as ArrayBuffer
  };
};

const releaseUrl = (asset: string): string =>
  `https://github.com/petehsu/Lyra-Language-Packs/releases/latest/download/${asset}`;

const signature = (value: Buffer, privateKey: KeyObject): Buffer =>
  Buffer.from(`${sign(null, value, privateKey).toString("base64")}\n`);

const releaseAssets = ({
  privateKey,
  locale = "ja-JP",
  version = "1.0.0",
  brokenPackSignature = false,
  badHash = false
}: {
  readonly privateKey: KeyObject;
  readonly locale?: string;
  readonly version?: string;
  readonly brokenPackSignature?: boolean;
  readonly badHash?: boolean;
}): AssetMap => {
  const rawBundle = Buffer.from(`${JSON.stringify(translatedBundle)}\n`, "utf8");
  const catalog = Buffer.from(`${JSON.stringify({
    schemaVersion: LANGUAGE_PACK_CATALOG_SCHEMA_VERSION,
    generatedAt: "2026-07-10T00:00:00.000Z",
    packs: [{
      locale,
      nativeName: "日本語",
      englishName: "Japanese",
      aliases: ["ja", "japanese"],
      version,
      minAppVersion: "1.0.0",
      sourceContentHash: languagePackContentHash(source),
      keysetHash: languagePackKeysetHash(source),
      sha256: badHash
        ? "0".repeat(64)
        : createHash("sha256").update(rawBundle).digest("hex"),
      asset: `${locale}.json`,
      signature: `${locale}.json.sig`
    }]
  })}\n`, "utf8");
  return {
    [releaseUrl("catalog.json")]: catalog,
    [releaseUrl("catalog.json.sig")]: signature(catalog, privateKey),
    [releaseUrl(`${locale}.json`)]: rawBundle,
    [releaseUrl(`${locale}.json.sig`)]: brokenPackSignature
      ? Buffer.from(`${Buffer.alloc(64).toString("base64")}\n`)
      : signature(rawBundle, privateKey)
  };
};

describe("official language packs", () => {
  let root = "";
  let dispose: (() => void) | null = null;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "lyra-language-packs-"));
    electronMocks.handlers.clear();
  });

  afterEach(async () => {
    dispose?.();
    dispose = null;
    await rm(root, { recursive: true, force: true });
  });

  test("rejects a package with mismatched interpolation tokens", () => {
    expect(() =>
      validateOfficialLanguagePackBundle(
        "ja-JP",
        { ...source, "tool.events": "{wrong} tool event" },
        {
          sourceContentHash: languagePackContentHash(source),
          keysetHash: languagePackKeysetHash(source)
        }
      )
    ).toThrow(/interpolation/i);
  });

  test("rejects a signed package that copies the English source", () => {
    expect(() =>
      validateOfficialLanguagePackBundle(
        "ja-JP",
        source,
        {
          sourceContentHash: languagePackContentHash(source),
          keysetHash: languagePackKeysetHash(source)
        }
      )
    ).toThrow(/coverage/i);
  });

  test("accepts a complete built-in component language bundle without translation coverage rules", () => {
    expect(validateComponentLanguagePackBundle("en-US", source)).toEqual(source);
  });

  test("merges signed component bundles into the runtime language resources", async () => {
    let componentBundles: Readonly<Record<string, Record<string, string>>> = {
      "en-US": source
    };
    const bridge = createLanguagePacksIpcBridge({
      storageRoot: root,
      appVersion: "1.0.0",
      startBackgroundChecks: false,
      readComponentBundles: async () => componentBundles
    });
    dispose = bridge.dispose;

    await expect(bridge.readManagedBundles()).resolves.toEqual({
      "en-US": source
    });
    componentBundles = {
      "en-US": source,
      "ja-JP": translatedBundle
    };
    await bridge.reloadComponentBundles();
    expect(bridge.resolveBrowserContextMenuLabels("ja-JP").back).toBe(
      translatedBundle["nativeMenu.back"]
    );
  });

  test("rejects a package whose signed asset is invalid", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const assets = releaseAssets({ privateKey, brokenPackSignature: true });
    const bridge = createLanguagePacksIpcBridge({
      storageRoot: root,
      appVersion: "1.0.0",
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      fetcher: async (url) => responseFor(assets, url),
      startBackgroundChecks: false
    });
    dispose = bridge.dispose;

    const install = electronMocks.handlers.get(LYRA_CHANNELS.languagePacksInstall);
    await expect(install?.({}, "ja-JP")).rejects.toThrow(/signature/i);
    const listInstalled = electronMocks.handlers.get(LYRA_CHANNELS.languagePacksListInstalled);
    await expect(listInstalled?.({})).resolves.toEqual([]);
  });

  test("rejects a package whose SHA-256 does not match the signed catalog", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const assets = releaseAssets({ privateKey, badHash: true });
    const bridge = createLanguagePacksIpcBridge({
      storageRoot: root,
      appVersion: "1.0.0",
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      fetcher: async (url) => responseFor(assets, url),
      startBackgroundChecks: false
    });
    dispose = bridge.dispose;

    const install = electronMocks.handlers.get(LYRA_CHANNELS.languagePacksInstall);
    await expect(install?.({}, "ja-JP")).rejects.toThrow(/SHA-256/i);
  });

  test("keeps the installed package when an automatic update fails", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    let assets = releaseAssets({ privateKey, version: "1.0.0" });
    const bridge = createLanguagePacksIpcBridge({
      storageRoot: root,
      appVersion: "1.0.0",
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      fetcher: async (url) => responseFor(assets, url),
      startBackgroundChecks: false
    });
    dispose = bridge.dispose;

    const install = electronMocks.handlers.get(LYRA_CHANNELS.languagePacksInstall);
    await install?.({}, "ja-JP");

    assets = releaseAssets({ privateKey, version: "1.0.1", brokenPackSignature: true });
    const checkForUpdates = electronMocks.handlers.get(LYRA_CHANNELS.languagePacksCheckForUpdates);
    await checkForUpdates?.({});

    const listInstalled = electronMocks.handlers.get(LYRA_CHANNELS.languagePacksListInstalled);
    await expect(listInstalled?.({})).resolves.toMatchObject([{ locale: "ja-JP", version: "1.0.0" }]);
  });

  test("removes an installed managed package and its runtime resource", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const assets = releaseAssets({ privateKey });
    const bridge = createLanguagePacksIpcBridge({
      storageRoot: root,
      appVersion: "1.0.0",
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      fetcher: async (url) => responseFor(assets, url),
      startBackgroundChecks: false
    });
    dispose = bridge.dispose;

    const install = electronMocks.handlers.get(LYRA_CHANNELS.languagePacksInstall);
    await install?.({}, "ja-JP");

    const uninstall = electronMocks.handlers.get(LYRA_CHANNELS.languagePacksUninstall);
    await expect(uninstall?.({}, "ja-JP")).resolves.toBeUndefined();

    const listInstalled = electronMocks.handlers.get(LYRA_CHANNELS.languagePacksListInstalled);
    await expect(listInstalled?.({})).resolves.toEqual([]);
    await expect(bridge.readManagedBundles()).resolves.toEqual({});
  });
});
