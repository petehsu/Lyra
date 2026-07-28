import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EN_US_DICTIONARY } from "../apps/desktop/src/shared/i18n/en-US";
import {
  LANGUAGE_PACK_CATALOG_SCHEMA_VERSION,
  NATIVE_CONTEXT_MENU_EN_US_TRANSLATIONS
} from "../apps/desktop/src/shared/language-packs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outputFlag = args.indexOf("--output");
const outputPath = outputFlag === -1
  ? path.join(root, "language-packs", "source-manifest.v1.json")
  : path.resolve(root, args[outputFlag + 1] ?? "");
const checkOnly = args.includes("--check");

const source = {
  ...EN_US_DICTIONARY,
  ...NATIVE_CONTEXT_MENU_EN_US_TRANSLATIONS
};

const entries = Object.entries(source)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, value]) => ({ key, source: value }));
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const packageVersion = JSON.parse(
  readFileSync(path.join(root, "apps", "desktop", "package.json"), "utf8")
) as { readonly version: string };
const manifest = {
  schemaVersion: LANGUAGE_PACK_CATALOG_SCHEMA_VERSION,
  appVersion: packageVersion.version,
  keysetHash: sha256(entries.map(({ key }) => key).join("\n")),
  contentHash: sha256(JSON.stringify(entries.map(({ key, source: value }) => [key, value]))),
  entries
};
const contents = `${JSON.stringify(manifest, null, 2)}\n`;

if (checkOnly) {
  if (existsSync(outputPath) === false || readFileSync(outputPath, "utf8") !== contents) {
    console.error(`[language-packs] source manifest is stale: ${path.relative(root, outputPath)}`);
    process.exit(1);
  }
  console.log(`[language-packs] source manifest is current (${entries.length} keys)`);
  process.exit(0);
}

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, contents, "utf8");
console.log(`[language-packs] wrote ${path.relative(root, outputPath)} (${entries.length} keys)`);
