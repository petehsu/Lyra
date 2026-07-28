import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(docsRoot, "..", "..");
const contractsRoot = path.join(docsRoot, "public", "contracts", "v1");
const examplesRoot = path.join(docsRoot, "public", "examples", "v1");

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const schemas = {
  mcp: readJson(path.join(contractsRoot, "mcp-config.schema.json")),
  skill: readJson(path.join(contractsRoot, "skill-frontmatter.schema.json")),
  language: readJson(path.join(contractsRoot, "language-pack-catalog.schema.json")),
  bundle: readJson(path.join(contractsRoot, "language-pack-bundle.schema.json")),
  uiux: readJson(path.join(contractsRoot, "uiux-pack.schema.json")),
  software: readJson(path.join(contractsRoot, "software-capability.schema.json"))
};

const resolvePointer = (root, reference) => {
  if (!reference.startsWith("#/")) throw new Error(`external $ref is not supported: ${reference}`);
  return reference
    .slice(2)
    .split("/")
    .reduce((value, token) => value[token.replaceAll("~1", "/").replaceAll("~0", "~")], root);
};

const validate = (value, schema, root, at = "$") => {
  if (schema === true || Object.keys(schema).length === 0) return [];
  if (schema === false) return [`${at}: schema rejects every value`];
  const errors = [];
  if (schema.$ref !== undefined) {
    errors.push(...validate(value, resolvePointer(root, schema.$ref), root, at));
  }
  if (schema.allOf !== undefined) {
    for (const child of schema.allOf) errors.push(...validate(value, child, root, at));
  }
  if (schema.not !== undefined && validate(value, schema.not, root, at).length === 0) {
    errors.push(`${at}: matches forbidden schema`);
  }
  if (schema.oneOf !== undefined) {
    const results = schema.oneOf.map((child) => validate(value, child, root, at));
    if (results.filter((result) => result.length === 0).length !== 1) {
      errors.push(`${at}: must match exactly one alternative`);
    }
  }
  if (schema.const !== undefined && !Object.is(value, schema.const)) {
    errors.push(`${at}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum !== undefined && !schema.enum.some((entry) => Object.is(entry, value))) {
    errors.push(`${at}: is not an allowed value`);
  }

  const actualType = Array.isArray(value)
    ? "array"
    : value === null
      ? "null"
      : typeof value === "object"
        ? "object"
        : typeof value;
  if (schema.type !== undefined && actualType !== schema.type) {
    errors.push(`${at}: expected ${schema.type}, received ${actualType}`);
    return errors;
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${at}: is shorter than ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${at}: is longer than ${schema.maxLength}`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) {
      errors.push(`${at}: does not match ${schema.pattern}`);
    }
    if (schema.format === "uri") {
      try {
        new URL(value);
      } catch {
        errors.push(`${at}: is not a URI`);
      }
    }
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
      errors.push(`${at}: is not a date-time`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${at}: has fewer than ${schema.minItems} items`);
    }
    if (schema.uniqueItems === true) {
      const serialized = value.map((item) => JSON.stringify(item));
      if (new Set(serialized).size !== serialized.length) errors.push(`${at}: items are not unique`);
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => {
        errors.push(...validate(item, schema.items, root, `${at}[${index}]`));
      });
    }
  }

  if (actualType === "object") {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
      errors.push(`${at}: has fewer than ${schema.minProperties} properties`);
    }
    for (const required of schema.required ?? []) {
      if (!(required in value)) errors.push(`${at}: missing ${required}`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (schema.propertyNames !== undefined) {
        errors.push(...validate(key, schema.propertyNames, root, `${at} property ${key}`));
      }
      if (schema.properties?.[key] !== undefined) {
        errors.push(...validate(item, schema.properties[key], root, `${at}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${at}: unknown property ${key}`);
      } else if (
        schema.additionalProperties !== undefined
        && typeof schema.additionalProperties === "object"
      ) {
        errors.push(...validate(item, schema.additionalProperties, root, `${at}.${key}`));
      }
    }
  }
  return errors;
};

const parseScalar = (value) => {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/u.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^(['"])(.*)\1$/u, "$2");
};

const parseFixtureFrontmatter = (markdown) => {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]+)$/u.exec(markdown);
  if (match === null || match[2].trim().length === 0) {
    throw new Error("SKILL.md requires closed frontmatter and a non-empty body");
  }
  const output = {};
  let currentArray = null;
  let currentObject = null;
  for (const line of match[1].split("\n")) {
    const top = /^([A-Za-z_][A-Za-z0-9_]*):(?:\s*(.*))?$/u.exec(line);
    if (top !== null) {
      currentObject = null;
      if ((top[2] ?? "").length === 0) {
        currentArray = [];
        output[top[1]] = currentArray;
      } else {
        currentArray = null;
        output[top[1]] = parseScalar(top[2]);
      }
      continue;
    }
    const item = /^  -\s*(.*)$/u.exec(line);
    if (item !== null && currentArray !== null) {
      const pair = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/u.exec(item[1]);
      if (pair === null) {
        currentArray.push(parseScalar(item[1]));
        currentObject = null;
      } else {
        currentObject = { [pair[1]]: parseScalar(pair[2]) };
        currentArray.push(currentObject);
      }
      continue;
    }
    const nested = /^    ([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/u.exec(line);
    if (nested !== null && currentObject !== null) {
      currentObject[nested[1]] = parseScalar(nested[2]);
      continue;
    }
    if (line.trim().length > 0) throw new Error(`unsupported fixture YAML line: ${line}`);
  }
  return output;
};

const fixtures = {
  mcp: readJson(path.join(examplesRoot, "mcp-config.json")),
  skill: parseFixtureFrontmatter(readFileSync(path.join(examplesRoot, "SKILL.md"), "utf8")),
  language: readJson(path.join(examplesRoot, "language-pack-catalog.json")),
  bundle: readJson(path.join(examplesRoot, "ja-JP.json")),
  uiux: readJson(path.join(examplesRoot, "uiux-plugin.json")),
  software: readJson(path.join(examplesRoot, "software-capability.json"))
};

const failures = [];
for (const [name, schema] of Object.entries(schemas)) {
  const metadata = schema["x-lyra-contract"];
  if (
    !["supported", "preview"].includes(metadata?.status)
    || metadata?.version !== "1"
    || metadata?.applicableAppVersion !== "0.1.x beta"
    || metadata?.verifiedDate !== "2026-07-28"
  ) {
    failures.push(`${name}: invalid x-lyra-contract metadata`);
  }
  const schemaFileName = {
    mcp: "mcp-config.schema.json",
    skill: "skill-frontmatter.schema.json",
    language: "language-pack-catalog.schema.json",
    bundle: "language-pack-bundle.schema.json",
    uiux: "uiux-pack.schema.json",
    software: "software-capability.schema.json"
  }[name];
  if (schema.$id !== `https://lyra.ltd/contracts/v1/${schemaFileName}`) {
    failures.push(`${name}: $id does not match the public serving path`);
  }
  failures.push(...validate(fixtures[name], schema, schema).map((error) => `${name}: ${error}`));
}

const sourceManifest = readJson(
  path.join(repoRoot, "language-packs", "source-manifest.v1.json")
);
const sourceKeys = sourceManifest.entries.map((entry) => entry.key);
if (
  JSON.stringify(schemas.bundle.required) !== JSON.stringify(sourceKeys)
  || JSON.stringify(Object.keys(schemas.bundle.properties)) !== JSON.stringify(sourceKeys)
  || schemas.bundle["x-lyra-source-keyset-hash"] !== sourceManifest.keysetHash
  || schemas.bundle["x-lyra-source-content-hash"] !== sourceManifest.contentHash
) {
  failures.push("bundle: Schema drifted from language-packs/source-manifest.v1.json");
}
if (
  JSON.stringify(Object.keys(fixtures.bundle)) !== JSON.stringify(sourceKeys)
  || sourceManifest.entries.some(
    (entry) => fixtures.bundle[entry.key] !== `[fixture-ja] ${entry.source}`
  )
) {
  failures.push("bundle: fixture drifted from language-packs/source-manifest.v1.json");
}
for (const pack of fixtures.language.packs) {
  if (
    pack.sourceContentHash !== sourceManifest.contentHash
    || pack.keysetHash !== sourceManifest.keysetHash
  ) {
    failures.push(`language: ${pack.locale} hashes do not match source-manifest.v1.json`);
  }
  const assetPath = path.join(examplesRoot, pack.asset);
  const assetDigest = createHash("sha256").update(readFileSync(assetPath)).digest("hex");
  if (pack.sha256 !== assetDigest) {
    failures.push(`language: ${pack.locale} sha256 does not match ${pack.asset}`);
  }
}
const locales = fixtures.language.packs.map((pack) => pack.locale);
if (new Set(locales).size !== locales.length) failures.push("language: locale entries repeat");

if (
  JSON.stringify(fixtures.uiux.uiuxPack.software[0])
  !== JSON.stringify(fixtures.software)
) {
  failures.push("uiux/software: nested and standalone fixture declarations drifted");
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `[contracts] ${failure}`).join("\n"));
  process.exit(1);
}

console.log("[contracts] six v1 Schemas and fixtures validated");
