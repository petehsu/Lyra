import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const read = (relativePath: string): string =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const uniqueSorted = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort();

const camelCase = (value: string): string =>
  value.length === 0 ? value : `${value[0]!.toLowerCase()}${value.slice(1)}`;

const extractTsEventKinds = (source: string): string[] => {
  const start = source.indexOf("export type AgentRuntimeEvent =");
  const end = source.indexOf("\nexport type AgentRegisteredCommand", start);
  if (start < 0 || end < 0) {
    throw new Error("could not locate AgentRuntimeEvent in apps/desktop/src/shared/agent.ts");
  }
  const block = source.slice(start, end);
  return uniqueSorted(
    [...block.matchAll(/readonly kind:\s*([^;]+);/g)]
      .flatMap((match) => [...match[1]!.matchAll(/"([^"]+)"/g)].map((kind) => kind[1]!))
  );
};

const extractRustStringConstArray = (source: string, name: string): string[] => {
  const match = source.match(new RegExp(`pub const ${name}: &\\[&str\\] = &\\[([\\s\\S]*?)\\];`));
  if (match === null) {
    throw new Error(`could not locate ${name}`);
  }
  return uniqueSorted([...match[1]!.matchAll(/"([^"]+)"/g)].map((entry) => entry[1]!));
};

const extractRustEnumVariants = (source: string, enumName: string): string[] => {
  const start = source.indexOf(`pub enum ${enumName} {`);
  if (start < 0) {
    throw new Error(`could not locate Rust enum ${enumName}`);
  }
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let bodyEnd = -1;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      bodyEnd = index;
      break;
    }
  }
  if (bodyEnd < 0) {
    throw new Error(`could not parse Rust enum ${enumName}`);
  }
  const body = source.slice(bodyStart + 1, bodyEnd);
  const variants: string[] = [];
  for (const line of body.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith("//")) {
      continue;
    }
    const match = trimmed.match(/^([A-Z][A-Za-z0-9_]*)\b/u);
    if (match !== null) {
      variants.push(match[1]!);
    }
  }
  return uniqueSorted(variants);
};

const assertSame = (label: string, left: readonly string[], right: readonly string[]): void => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const missing = right.filter((value) => !leftSet.has(value));
  const extra = left.filter((value) => !rightSet.has(value));
  if (missing.length === 0 && extra.length === 0) {
    return;
  }
  throw new Error([
    `${label} drifted`,
    missing.length === 0 ? null : `missing: ${missing.join(", ")}`,
    extra.length === 0 ? null : `extra: ${extra.join(", ")}`,
  ].filter(Boolean).join("\n"));
};

const tsSource = read("apps/desktop/src/shared/agent.ts");
const runtimeEventSource = read("crates/lyra-agent-runtime/src/agent_event.rs");
const apiSource = read("crates/lyra-agent-api/src/lib.rs");

const tsEventKinds = extractTsEventKinds(tsSource);
const runtimeEventKinds = extractRustStringConstArray(runtimeEventSource, "TS_UNION_KINDS");
const apiEventKinds = extractRustEnumVariants(apiSource, "AgentRuntimeEvent").map(camelCase).sort();

assertSame("TS AgentRuntimeEvent vs Rust runtime event manifest", tsEventKinds, runtimeEventKinds);
assertSame("lyra-agent-api AgentRuntimeEvent vs TS AgentRuntimeEvent", apiEventKinds, tsEventKinds);

const tsTurnStatuses = uniqueSorted(
  [...(tsSource.match(/export type AgentTurnStatus = ([^;]+);/)?.[1] ?? "").matchAll(/"([^"]+)"/g)]
    .map((match) => match[1]!)
);
const apiSessionStatuses = extractRustEnumVariants(apiSource, "AgentSessionStatus")
  .map(camelCase)
  .sort();
assertSame("Agent turn/session status", tsTurnStatuses, apiSessionStatuses);

console.log("[agent-contract] OK — TS and Rust event/status contracts match.");
