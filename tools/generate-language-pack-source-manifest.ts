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
const hasExplicitOutput = outputFlag !== -1;
const outputPath = outputFlag === -1
  ? path.join(root, "language-packs", "source-manifest.v1.json")
  : path.resolve(root, args[outputFlag + 1] ?? "");
const checkOnly = args.includes("--check");
const docsContractsRoot = path.join(root, "web", "docs", "public", "contracts", "v1");
const docsExamplesRoot = path.join(root, "web", "docs", "public", "examples", "v1");
const bundleSchemaPath = path.join(docsContractsRoot, "language-pack-bundle.schema.json");
const fixturePath = path.join(docsExamplesRoot, "ja-JP.json");
const catalogPath = path.join(docsExamplesRoot, "language-pack-catalog.json");

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
const jsonContents = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const contents = jsonContents(manifest);

type JsonRecord = Record<string, unknown>;

const readJsonRecord = (filePath: string): JsonRecord => {
  const value = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path.relative(root, filePath)} must contain a JSON object`);
  }
  return value as JsonRecord;
};

const bundleSchema = {
  ...readJsonRecord(bundleSchemaPath),
  "x-lyra-source-keyset-hash": manifest.keysetHash,
  "x-lyra-source-content-hash": manifest.contentHash,
  required: entries.map(({ key }) => key),
  properties: Object.fromEntries(
    entries.map(({ key }) => [key, { type: "string" }])
  )
};
const bundleFixture = Object.fromEntries(
  entries.map(({ key, source: value }) => [key, `[fixture-ja] ${value}`])
);
const fixtureContents = jsonContents(bundleFixture);
const catalog = readJsonRecord(catalogPath);
if (Array.isArray(catalog.packs) === false) {
  throw new Error(`${path.relative(root, catalogPath)} must contain a packs array`);
}
const catalogWithCurrentSource = {
  ...catalog,
  packs: catalog.packs.map((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${path.relative(root, catalogPath)} contains an invalid pack`);
    }
    const pack = value as JsonRecord;
    if (pack.asset !== "ja-JP.json") {
      return pack;
    }
    return {
      ...pack,
      sourceContentHash: manifest.contentHash,
      keysetHash: manifest.keysetHash,
      sha256: sha256(fixtureContents)
    };
  })
};

const generatedFiles = hasExplicitOutput
  ? [[outputPath, contents] as const]
  : [
      [outputPath, contents] as const,
      [bundleSchemaPath, jsonContents(bundleSchema)] as const,
      [fixturePath, fixtureContents] as const,
      [catalogPath, jsonContents(catalogWithCurrentSource)] as const
    ];

if (checkOnly) {
  const staleFiles = generatedFiles
    .filter(([filePath, expected]) =>
      existsSync(filePath) === false || readFileSync(filePath, "utf8") !== expected
    )
    .map(([filePath]) => path.relative(root, filePath));
  if (staleFiles.length > 0) {
    for (const filePath of staleFiles) {
      console.error(`[language-packs] generated contract is stale: ${filePath}`);
    }
    process.exit(1);
  }
  console.log(
    `[language-packs] source manifest and public contracts are current (${entries.length} keys)`
  );
  process.exit(0);
}

for (const [filePath, generatedContents] of generatedFiles) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, generatedContents, "utf8");
  console.log(`[language-packs] wrote ${path.relative(root, filePath)}`);
}
console.log(`[language-packs] synchronized ${entries.length} translation keys`);
