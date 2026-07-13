import { describe, expect, test, vi } from "vitest";

import { resolveStartupLocale } from "./startup-locale";

describe("resolveStartupLocale", () => {
  test("prefers built-in Chinese and English locales", async () => {
    const install = vi.fn();
    const result = await resolveStartupLocale({
      requestedLocale: "zh-Hant-TW",
      installed: [],
      catalog: { packs: [], status: "ready" },
      install
    });

    expect(result).toEqual({ locale: "zh-CN" });
    expect(install).not.toHaveBeenCalled();
  });

  test("uses an installed remote language before downloading", async () => {
    const result = await resolveStartupLocale({
      requestedLocale: "de-DE",
      installed: [{
        locale: "de-DE",
        version: "1",
        installedAt: "2026-07-11T00:00:00.000Z",
        updatedAt: "2026-07-11T00:00:00.000Z",
        sourceContentHash: "source",
        keysetHash: "keys",
        sha256: "sha"
      }],
      catalog: { packs: [], status: "ready" },
      install: vi.fn()
    });

    expect(result).toEqual({ locale: "de-DE" });
  });

  test("downloads a matching catalog language and falls back to English on failure", async () => {
    const install = vi.fn().mockResolvedValue(undefined);
    const downloaded = await resolveStartupLocale({
      requestedLocale: "fr-CA",
      installed: [],
      catalog: {
        packs: [{
          locale: "fr-FR",
          nativeName: "Français",
          englishName: "French",
          aliases: ["fr"],
          version: "1",
          minAppVersion: "0.1.0",
          sourceContentHash: "source",
          keysetHash: "keys",
          sha256: "sha",
          asset: "fr-FR.json",
          signature: "signature"
        }],
        status: "ready"
      },
      install
    });

    expect(downloaded).toEqual({ locale: "fr-FR", downloadedLocale: "fr-FR" });
    expect(install).toHaveBeenCalledWith("fr-FR");

    const fallback = await resolveStartupLocale({
      requestedLocale: "ja-JP",
      installed: [],
      catalog: { packs: [], status: "unavailable" },
      install: vi.fn()
    });

    expect(fallback).toEqual({ locale: "en-US" });
  });
});
