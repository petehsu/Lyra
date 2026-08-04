import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  parseComponentUpdateChannels,
  readComponentUpdateChannels,
  resolveComponentUpdateChannelConfigPath
} from "./channels";

const config = {
  schemaVersion: 1,
  channels: {
    stable: "https://github.com/petehsu/lyra-releases/releases/download/stable-channel/catalog-stable-{target}.json",
    preview: "https://github.com/petehsu/lyra-releases/releases/download/preview-channel/catalog-preview-{target}.json"
  }
};

describe("component update channels", () => {
  test("resolves development config from both supported monorepo launch roots", async () => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "lyra-update-channel-path-"));
    const desktopRoot = path.join(repositoryRoot, "apps", "desktop");
    const configPath = path.join(
      desktopRoot,
      "resources",
      "component-update",
      "channels.v1.json"
    );
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(config)}\n`);
    try {
      expect(resolveComponentUpdateChannelConfigPath({
        resourcesPath: path.join(repositoryRoot, "packaged-resources"),
        isPackaged: false,
        cwd: repositoryRoot
      })).toBe(configPath);
      expect(resolveComponentUpdateChannelConfigPath({
        resourcesPath: path.join(repositoryRoot, "packaged-resources"),
        isPackaged: false,
        cwd: desktopRoot
      })).toBe(configPath);
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });

  test("never falls back to source-tree channel config in packaged Core", () => {
    expect(resolveComponentUpdateChannelConfigPath({
      resourcesPath: "/signed/core/resources",
      isPackaged: true,
      cwd: "/untrusted/source-tree"
    })).toBe(path.join("/signed/core/resources", "component-update", "channels.v1.json"));
  });

  test("resolves an exact target into the packaged channel locations", () => {
    expect(parseComponentUpdateChannels(config, "darwin-arm64")).toEqual({
      stable: "https://github.com/petehsu/lyra-releases/releases/download/stable-channel/catalog-stable-darwin-arm64.json",
      preview: "https://github.com/petehsu/lyra-releases/releases/download/preview-channel/catalog-preview-darwin-arm64.json"
    });
  });

  test("rejects untrusted URL forms and unknown configuration fields", () => {
    expect(() => parseComponentUpdateChannels({
      ...config,
      channels: { preview: "http://example.test/catalog-{target}.json" }
    }, "linux-x64")).toThrow(/credential-free HTTPS/u);
    expect(() => parseComponentUpdateChannels({
      ...config,
      channels: { preview: "https://example.test/catalog.json" }
    }, "linux-x64")).toThrow(/exactly one/u);
    expect(() => parseComponentUpdateChannels({
      ...config,
      channels: { ...config.channels, nightly: "https://example.test/{target}.json" }
    }, "linux-x64")).toThrow(/configuration is invalid/u);
  });

  test("ignores environment channel replacement in packaged builds", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "lyra-update-channels-"));
    const directory = path.join(temporary, "component-update");
    await mkdir(directory, { recursive: true });
    const filePath = path.join(directory, "channels.v1.json");
    await writeFile(filePath, `${JSON.stringify(config)}\n`);
    try {
      await expect(readComponentUpdateChannels({
        filePath,
        target: "windows-x64",
        isPackaged: true,
        env: {
          LYRA_COMPONENT_PREVIEW_CATALOG_URL: "https://attacker.example/catalog.json"
        }
      })).resolves.toMatchObject({
        preview: "https://github.com/petehsu/lyra-releases/releases/download/preview-channel/catalog-preview-windows-x64.json"
      });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
