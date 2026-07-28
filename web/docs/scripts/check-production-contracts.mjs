import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseUiuxPackManifest,
  resolveUiuxPackRuntimePaths
} from "../../../apps/desktop/src/main/uiux-packs/registry";
import {
  validateOfficialLanguagePackBundle,
  validateOfficialLanguagePackCatalog
} from "../../../apps/desktop/src/main/language-packs/service";
import {
  validateInputSchema
} from "../../../apps/desktop/src/modules/workbench/software-capabilities/validation";

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(docsRoot, "..", "..");
const examplesRoot = path.join(docsRoot, "public", "examples", "v1");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

const packageRoot = mkdtempSync(path.join(os.tmpdir(), "lyra-public-uiux-"));

try {
  mkdirSync(path.join(packageRoot, ".lyra-plugin"), { recursive: true });
  mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
  mkdirSync(path.join(packageRoot, "l10n"), { recursive: true });
  writeFileSync(
    path.join(packageRoot, ".lyra-plugin", "plugin.json"),
    `${JSON.stringify(readJson(path.join(examplesRoot, "uiux-plugin.json")), null, 2)}\n`,
    "utf8"
  );
  writeFileSync(path.join(packageRoot, "dist", "index.js"), "export {};\n", "utf8");
  writeFileSync(path.join(packageRoot, "dist", "styles.css"), "", "utf8");

  const manifest = parseUiuxPackManifest(packageRoot);
  const runtimePaths = resolveUiuxPackRuntimePaths(packageRoot, manifest);
  if (
    manifest.id !== "external:fixture-uiux"
    || manifest.software[0]?.id !== "external:fixture-uiux:fixture-notes"
    || manifest.software[0]?.actions[0]?.id
      !== "external:fixture-uiux:fixture-notes.create-note"
    || runtimePaths.entryPath !== path.join(packageRoot, "dist", "index.js")
  ) {
    throw new Error("production UIUX parser normalized the public fixture unexpectedly");
  }

  const softwareFixture = readJson(
    path.join(examplesRoot, "software-capability.json")
  );
  const inputErrors = validateInputSchema(
    { text: "fixture" },
    softwareFixture.actions?.[0]?.inputSchema
  );
  if (inputErrors.length > 0) {
    throw new Error(`production software input validator rejected fixture: ${inputErrors.join(", ")}`);
  }

  const catalog = validateOfficialLanguagePackCatalog(
    readJson(path.join(examplesRoot, "language-pack-catalog.json")),
    "0.1.0"
  );
  if (catalog.packs[0]?.locale !== "ja-JP") {
    throw new Error("production language-pack validator changed fixture output");
  }
  const bundle = validateOfficialLanguagePackBundle(
    "ja-JP",
    readJson(path.join(examplesRoot, "ja-JP.json")),
    {
      sourceContentHash: catalog.packs[0].sourceContentHash,
      keysetHash: catalog.packs[0].keysetHash
    }
  );
  const sourceManifest = readJson(
    path.join(repoRoot, "language-packs", "source-manifest.v1.json")
  );
  const expectedKeys = sourceManifest.entries.map((entry) => entry.key);
  if (
    JSON.stringify(Object.keys(bundle)) !== JSON.stringify(expectedKeys)
    || sourceManifest.keysetHash !== catalog.packs[0].keysetHash
    || sourceManifest.contentHash !== catalog.packs[0].sourceContentHash
  ) {
    throw new Error("production language-pack bundle validator changed fixture keyset");
  }
} finally {
  rmSync(packageRoot, { recursive: true, force: true });
}

console.log(
  "[contracts] production UIUX, Software Capability, language catalog, and language bundle validators accepted public fixtures"
);
