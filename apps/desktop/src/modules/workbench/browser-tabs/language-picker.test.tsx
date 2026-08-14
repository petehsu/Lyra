import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { LanguagePackCatalogResponse } from "../../../shared/language-packs";
import { LanguagePicker } from "./language-picker";

const labels = {
  searchPlaceholder: "Search languages",
  installing: "Installing",
  removing: "Removing",
  download: "Download",
  remove: "Remove",
  noResults: "No languages found"
} as const;

describe("LanguagePicker", () => {
  test("shows the remote catalog error instead of reporting an empty search result", async () => {
    const user = userEvent.setup();
    const catalog = {
      status: "unavailable" as const,
      packs: [],
      error: "Language catalog could not be downloaded"
    };
    const desktopApi = {
      languagePacks: {
        listCatalog: vi.fn(async () => catalog),
        listInstalled: vi.fn(async () => []),
        install: vi.fn(),
        uninstall: vi.fn(),
        checkForUpdates: vi.fn(async () => catalog),
        onChanged: vi.fn(() => () => undefined)
      }
    } as unknown as LyraDesktopApi;

    render(
      <LanguagePicker
        value="en-US"
        builtins={[{ value: "en-US", label: "English (US)" }]}
        labels={labels}
        desktopApi={desktopApi}
        onChange={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Search languages" }));
    await user.type(screen.getByRole("combobox"), "中文");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Language catalog could not be downloaded"
    );
    expect(screen.queryByText("No languages found")).toBeNull();
  });

  test("refreshes the official catalog when opened and finds Japanese by its Chinese name", async () => {
    const user = userEvent.setup();
    const unavailableCatalog: LanguagePackCatalogResponse = {
      status: "unavailable" as const,
      packs: []
    };
    const remoteCatalog: LanguagePackCatalogResponse = {
      status: "ready" as const,
      packs: [{
        locale: "ja-JP",
        nativeName: "日本語",
        englishName: "Japanese",
        aliases: ["nihongo", "jp"],
        version: "1.0.0",
        minAppVersion: "0.1.0",
        sourceContentHash: "a".repeat(64),
        keysetHash: "b".repeat(64),
        sha256: "c".repeat(64),
        asset: "ja-JP.json",
        signature: "ja-JP.json.sig"
      }]
    };
    let catalog: LanguagePackCatalogResponse = unavailableCatalog;
    let updateChecks = 0;
    const listCatalog = vi.fn(async () => catalog);
    const checkForUpdates = vi.fn(async () => {
      updateChecks += 1;
      if (updateChecks > 1) {
        catalog = remoteCatalog;
      }
      return catalog;
    });
    const desktopApi = {
      languagePacks: {
        listCatalog,
        listInstalled: vi.fn(async () => []),
        install: vi.fn(),
        uninstall: vi.fn(),
        checkForUpdates,
        onChanged: vi.fn(() => () => undefined)
      }
    } as unknown as LyraDesktopApi;

    render(
      <LanguagePicker
        value="zh-CN"
        builtins={[
          { value: "zh-CN", label: "简体中文" },
          { value: "en-US", label: "English (US)" }
        ]}
        labels={labels}
        desktopApi={desktopApi}
        onChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(checkForUpdates).toHaveBeenCalledTimes(1);
    });
    await user.click(screen.getByRole("button", { name: "Search languages" }));
    const input = await screen.findByRole("combobox");
    await user.type(input, "日语");

    await waitFor(() => {
      expect(checkForUpdates).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("option", { name: /日本語/u })).toBeInTheDocument();
    });
  });

  test("filters, installs, and immediately selects an official language", async () => {
    const user = userEvent.setup();
    const install = vi.fn(async () => ({
      locale: "ja-JP",
      version: "1.0.0",
      installedAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
      sourceContentHash: "a".repeat(64),
      keysetHash: "b".repeat(64),
      sha256: "c".repeat(64)
    }));
    const onChange = vi.fn();
    const desktopApi = {
      languagePacks: {
        listCatalog: vi.fn(async () => ({
          status: "ready" as const,
          packs: [{
            locale: "ja-JP",
            nativeName: "日本語",
            englishName: "Japanese",
            aliases: ["nihongo", "jp"],
            version: "1.0.0",
            minAppVersion: "0.1.0",
            sourceContentHash: "a".repeat(64),
            keysetHash: "b".repeat(64),
            sha256: "c".repeat(64),
            asset: "ja-JP.json",
            signature: "ja-JP.json.sig"
          }]
        })),
        listInstalled: vi.fn(async () => []),
        install,
        uninstall: vi.fn(),
        checkForUpdates: vi.fn(async () => ({ status: "ready" as const, packs: [] })),
        onChanged: vi.fn(() => () => undefined)
      }
    } as unknown as LyraDesktopApi;

    render(
      <LanguagePicker
        value="en-US"
        builtins={[
          { value: "zh-CN", label: "Simplified Chinese" },
          { value: "en-US", label: "English (US)" }
        ]}
        labels={labels}
        desktopApi={desktopApi}
        onChange={onChange}
      />
    );

    await user.click(screen.getByRole("button", { name: "Search languages" }));
    const input = await screen.findByRole("combobox");
    await user.type(input, "nihongo");
    expect(screen.getByRole("button", { name: "Download: 日本語" })).toBeInTheDocument();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(install).toHaveBeenCalledWith("ja-JP");
      expect(onChange).toHaveBeenCalledWith("ja-JP");
    });
  });

  test("uses an icon-only remove action for installed non-current languages", async () => {
    const user = userEvent.setup();
    let installed = [{
      locale: "ja-JP",
      version: "1.0.0",
      installedAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
      sourceContentHash: "a".repeat(64),
      keysetHash: "b".repeat(64),
      sha256: "c".repeat(64)
    }];
    const uninstall = vi.fn(async (locale: string) => {
      installed = installed.filter((pack) => pack.locale !== locale);
    });
    const desktopApi = {
      languagePacks: {
        listCatalog: vi.fn(async () => ({
          status: "ready" as const,
          packs: [{
            locale: "ja-JP",
            nativeName: "日本語",
            englishName: "Japanese",
            aliases: ["nihongo", "jp"],
            version: "1.0.0",
            minAppVersion: "0.1.0",
            sourceContentHash: "a".repeat(64),
            keysetHash: "b".repeat(64),
            sha256: "c".repeat(64),
            asset: "ja-JP.json",
            signature: "ja-JP.json.sig"
          }]
        })),
        listInstalled: vi.fn(async () => installed),
        install: vi.fn(),
        uninstall,
        checkForUpdates: vi.fn(async () => ({ status: "ready" as const, packs: [] })),
        onChanged: vi.fn(() => () => undefined)
      }
    } as unknown as LyraDesktopApi;

    render(
      <LanguagePicker
        value="en-US"
        builtins={[
          { value: "zh-CN", label: "Simplified Chinese" },
          { value: "en-US", label: "English (US)" }
        ]}
        labels={labels}
        desktopApi={desktopApi}
        onChange={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Search languages" }));
    const option = await screen.findByRole("option", { name: "日本語" });
    expect(option).not.toHaveTextContent("ja-JP");
    expect(screen.queryByText("Installed")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove: 日本語" }));

    await waitFor(() => {
      expect(uninstall).toHaveBeenCalledWith("ja-JP");
      expect(screen.queryByRole("button", { name: "Remove: 日本語" })).not.toBeInTheDocument();
    });
  });
});
