import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  parseExternalBrowserProbeResult,
  resolveDownloadManagerProbeScriptCandidates
} from "../browser-import";

describe("external browser download import", () => {
  test("normalizes Python probe output", () => {
    expect(parseExternalBrowserProbeResult(JSON.stringify({
      ok: true,
      candidates: [
        {
          browser: "Chrome",
          profile: "Default",
          url: "https://example.com/file.zip",
          partialFilePath: "/tmp/file.zip.crdownload",
          referrer: "https://example.com/",
          receivedBytes: 1024,
          totalBytes: 4096
        },
        {
          browser: "Chrome",
          partialFilePath: "/tmp/missing-url.crdownload"
        }
      ]
    }))).toEqual([{
      browser: "Chrome",
      profile: "Default",
      url: "https://example.com/file.zip",
      partialFilePath: "/tmp/file.zip.crdownload",
      referrer: "https://example.com/",
      receivedBytes: 1024,
      totalBytes: 4096
    }]);
  });

  test("resolves packaged and development probe script candidates", () => {
    expect(resolveDownloadManagerProbeScriptCandidates({
      appPath: "/app",
      resourcesPath: "/resources",
      cwd: "/repo"
    })).toEqual([
      path.join("/resources", "download-manager", "browser_download_probe.py"),
      path.join("/resources", "resources", "download-manager", "browser_download_probe.py"),
      path.join("/app", "resources", "download-manager", "browser_download_probe.py"),
      path.join("/repo", "apps/desktop/resources/download-manager/browser_download_probe.py")
    ]);
  });
});
