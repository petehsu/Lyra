import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  installUiuxPackageFromRoot,
  readTrustedUiuxPack,
  readUiuxRegistryDocument,
  requestUiuxPackActivationInRegistry,
  updateUiuxPackTrustState
} from "../registry";

const createPackage = (root: string): void => {
  mkdirSync(path.join(root, ".lyra-plugin"), { recursive: true });
  mkdirSync(path.join(root, "dist"), { recursive: true });
  writeFileSync(
    path.join(root, ".lyra-plugin", "plugin.json"),
    JSON.stringify({
      id: "acme.theme",
      version: "1.2.3",
      title: "Acme Theme",
      description: "A trusted UIUX pack.",
      uiux: {
        entry: "dist/index.js",
        css: "dist/style.css",
        workbenchUiApi: "1"
      },
      permissions: ["desktop-api"]
    }),
    "utf8"
  );
  writeFileSync(path.join(root, "dist", "index.js"), "export const manifest = {};\n", "utf8");
  writeFileSync(path.join(root, "dist", "style.css"), ".acme {}\n", "utf8");
};

describe("uiux pack registry", () => {
  test("installs local UIUX packages as untrusted external packs", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "lyra-uiux-test-"));
    const storageRoot = path.join(tempRoot, "storage");
    const packageRoot = path.join(tempRoot, "package");
    createPackage(packageRoot);

    const installed = installUiuxPackageFromRoot({
      storageRoot,
      sourceRoot: packageRoot,
      source: {
        kind: "local",
        path: packageRoot
      }
    });

    expect(installed.id).toBe("external:acme.theme");
    expect(installed.trustState).toBe("untrusted");
    expect(installed.manifest.workbenchUiApi).toBe("1");
    expect(installed.entryPath.endsWith(path.join("dist", "index.js"))).toBe(true);
    expect(readTrustedUiuxPack(storageRoot, installed.id)).toBeNull();
  });

  test("trust gates runtime visibility and activation", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "lyra-uiux-test-"));
    const storageRoot = path.join(tempRoot, "storage");
    const packageRoot = path.join(tempRoot, "package");
    createPackage(packageRoot);
    const installed = installUiuxPackageFromRoot({
      storageRoot,
      sourceRoot: packageRoot,
      source: {
        kind: "local",
        path: packageRoot
      }
    });

    expect(() => {
      requestUiuxPackActivationInRegistry({
        storageRoot,
        packId: installed.id
      });
    }).toThrow("must be trusted");

    const trusted = updateUiuxPackTrustState({
      storageRoot,
      packId: installed.id,
      trustState: "trusted"
    });
    expect(trusted.trustState).toBe("trusted");
    expect(readTrustedUiuxPack(storageRoot, installed.id)?.id).toBe(installed.id);

    requestUiuxPackActivationInRegistry({
      storageRoot,
      packId: installed.id
    });
    expect(readUiuxRegistryDocument(storageRoot).pendingExternalPackId).toBe(installed.id);
  });
});
