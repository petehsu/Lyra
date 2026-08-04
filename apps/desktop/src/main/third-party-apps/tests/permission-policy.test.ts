import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

import { createThirdPartyAppPermissionPolicy } from "../permission-policy";

const temporaryDirectories: string[] = [];

const createAppFixture = (): { readonly root: string; readonly entry: string } => {
  const root = mkdtempSync(join(tmpdir(), "lyra-third-party-policy-"));
  const entry = join(root, "index.html");
  writeFileSync(entry, "<!doctype html>");
  temporaryDirectories.push(root);
  return { root, entry };
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("third-party application permission policy", () => {
  test("denies network, user files, and clipboard access by default", () => {
    const fixture = createAppFixture();
    const outsideFile = join(tmpdir(), "lyra-third-party-outside.txt");
    writeFileSync(outsideFile, "private");
    try {
      const policy = createThirdPartyAppPermissionPolicy({ appRoot: fixture.root });

      expect(policy.allowsRequest(pathToFileURL(fixture.entry).toString())).toBe(true);
      expect(policy.allowsRequest(pathToFileURL(outsideFile).toString())).toBe(false);
      expect(policy.allowsRequest("https://api.example.test/data")).toBe(false);
      expect(policy.allowsElectronPermission("clipboard-read")).toBe(false);
      expect(policy.allowsElectronPermission("clipboard-sanitized-write")).toBe(false);
      expect(policy.allowsElectronPermission("fileSystem")).toBe(false);
    } finally {
      rmSync(outsideFile, { force: true });
    }
  });

  test("allows only declared capabilities and exact network origins", () => {
    const fixture = createAppFixture();
    const policy = createThirdPartyAppPermissionPolicy({
      appRoot: fixture.root,
      permissions: ["network", "clipboard-read", "file-read"],
      networkOrigins: ["https://api.example.test"]
    });

    expect(policy.allowsRequest("https://api.example.test/data?q=1")).toBe(true);
    expect(policy.allowsRequest("wss://api.example.test/socket")).toBe(false);
    expect(policy.allowsRequest("https://other.example.test/data")).toBe(false);
    expect(policy.allowsElectronPermission("clipboard-read")).toBe(true);
    expect(policy.allowsElectronPermission("clipboard-sanitized-write")).toBe(false);
    expect(policy.allowsElectronPermission("fileSystem")).toBe(false);
    expect(policy.allowsRpcPermission("file-read")).toBe(true);
    expect(policy.allowsNavigation("https://api.example.test/app")).toBe(false);
  });
});
