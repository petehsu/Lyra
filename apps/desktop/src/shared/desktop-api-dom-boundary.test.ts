import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import type { FilesApi, LyraDesktopApi } from "./desktop-bridge";

const desktopBridgeSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "desktop-bridge.ts"),
  "utf8"
);

describe("stable Desktop API DOM boundary", () => {
  test("FilesApi and LyraDesktopApi do not take a browser File", () => {
    expect(desktopBridgeSource).not.toMatch(/\bfile:\s*File\b/);
    expect(desktopBridgeSource).not.toMatch(/\bgetPathForFile\b/);
    const filesApiExposesGetPathForFile = false as (
      "getPathForFile" extends keyof FilesApi ? true : false
    );
    const desktopApiFilesIsFilesApi = true as (
      LyraDesktopApi["files"] extends FilesApi ? true : false
    );
    expect(filesApiExposesGetPathForFile).toBe(false);
    expect(desktopApiFilesIsFilesApi).toBe(true);
  });
});
