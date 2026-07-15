import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set([".rs", ".ts", ".tsx", ".js", ".jsx"]);
const ROOTS = [
  "crates/lyra-agent-runtime/src",
  "crates/lyra-agent-core/src",
  "crates/lyra-tool-fs-core/src",
  "apps/desktop/src/main",
  "packages",
  "services"
] as const;
const EXCLUDED_SEGMENTS = new Set([
  "build",
  "dist",
  "fixtures",
  "generated",
  "node_modules",
  "snapshots",
  "target",
  "test",
  "tests"
]);

const SOURCE_AUDIT_PATHS = [
  "crates/lyra-agent-runtime/src/native_backend/secret_guard.rs",
  "crates/lyra-agent-runtime/src/native_backend/tools/design_quality.rs",
  "crates/lyra-agent-runtime/src/native_backend/tools/design_reference.rs"
] as const;
const USER_LITERAL_FILTER_PATHS = [
  "apps/desktop/src/main/agent/lumen-tool-host.ts",
  "apps/desktop/src/main/workbench-browser/view-manager-runtime/agent-element-matcher.ts",
  "apps/desktop/src/main/workbench-browser/view-manager-runtime/agent-plan-runtime.ts",
  "apps/desktop/src/main/workbench-browser/view-manager-runtime/ax-controller.ts",
  "apps/desktop/src/main/workbench-browser/view-manager-runtime/normalizers.ts",
  "crates/lyra-agent-runtime/src/native_backend/mcp_catalog.rs",
  "crates/lyra-agent-runtime/src/native_backend/permission_policy.rs",
  "crates/lyra-agent-runtime/src/native_backend/tools/search.rs"
] as const;
const TOOL_DESCRIPTION_SEARCH_PATHS = [
  "crates/lyra-tool-fs-core/src/search.rs",
  "crates/lyra-tool-fs-core/src/scene.rs",
  "crates/lyra-agent-runtime/src/native_backend/tools/tool_fs"
] as const;
const STRUCTURED_PROTOCOL_PATHS = [
  "apps/desktop/src/main/linux-compat/service.ts",
  "apps/desktop/src/main/terminal/service.ts",
  "apps/desktop/src/main/workbench-browser/view-manager-runtime/rendered-snapshot-runtime.ts",
  "apps/desktop/src/main/workbench-documents/detector.ts",
  "crates/lyra-agent-runtime/src/native_backend/memory_compress.rs",
  "crates/lyra-agent-runtime/src/native_backend/provider.rs",
  "crates/lyra-agent-runtime/src/native_backend/providers/protocol/openai_common/discovery.rs",
  "crates/lyra-agent-runtime/src/native_backend/tool_protocol.rs",
  "services/browser-automation/src/modules/cdp_inspector/index.ts"
] as const;
const REGEX_SYNTAX_PATHS = new Set([
  "apps/desktop/src/main/agent/host-persona-context.ts",
  "apps/desktop/src/main/linux-compat/service.ts",
  "apps/desktop/src/main/location/service.ts",
  "apps/desktop/src/main/terminal/service.ts",
  "apps/desktop/src/main/workbench-browser/view-manager-runtime/rendered-snapshot-runtime.ts",
  "apps/desktop/src/main/workbench-documents/detector.ts",
  "apps/desktop/src/main/workbench-documents/service.ts",
  "crates/lyra-agent-runtime/src/native_backend/provider.rs",
  "crates/lyra-agent-runtime/src/native_backend/providers/protocol/openai_common/discovery.rs",
  "crates/lyra-agent-runtime/src/native_backend/tool_protocol.rs",
  "crates/lyra-agent-runtime/src/persona/signals.rs",
  "services/browser-automation/src/modules/cdp_inspector/index.ts"
]);

const MATCH_SITE =
  /\.(?:contains|includes|match)\s*\(|(?:Regex::new|RegexBuilder::new|new RegExp)\s*\(/gu;
const NATURAL_LANGUAGE_RECEIVER =
  /\b(?:error|message|detail|reason|title|body|content|goal|intent|task|request|prompt|user|correction|demo|prototype|haystack)(?!_?(?:id|ids|ref|refs|type)\b)\w*(?:\.(?:message|text|content))?\s*(?:\.to_ascii_lowercase\(\)|\.toLowerCase\(\)|\.toLocaleLowerCase\(\)|\.to_string\(\)|\.toString\(\))?\s*\.(?:contains|includes|match)\s*\(/iu;
const NATURAL_LANGUAGE_REGEX =
  /(?:Regex::new|RegexBuilder::new|new RegExp)\s*\([^)]*(?:intent|demo|prototype|design|计划|设计|界面|演示|原型)/iu;
const STRUCTURED_CONTEXT =
  /(?:action|ansi|artifact|autocomplete|bytes|capabilit|capture|code|color|command|control|dependency|desktop|document|domain|element|email|enum|extension|file|format|header|host|id|index|input|key|kind|label|logo|marker|method|mime|model|name|needle|network|operation|ordinal|output|path|platform|protocol|provider|rel|required|role|schema|selector|source|status|suffix|symbol|tag|token|trim|type|url|username|version|warning)/iu;
const COLLECTION_MEMBERSHIP =
  /\.(?:contains|includes)\s*\(\s*(?:&?[A-Za-z_][A-Za-z0-9_.]*|['"][^A-Za-z\u0080-\uFFFF]*['"])\s*\)/u;
const STRUCTURED_RECEIVER_ARGUMENT =
  /\.(?:contains|includes|match)\s*\(\s*(?:&?[A-Za-z_][A-Za-z0-9_.]*(?:marker|code|id|ref|token|tag|path|selector|query|regex)|["']<lyra-[^"']+["']|["'][A-Z0-9_./:<>{}\-[\]"']+["'])\s*\)/u;
const STRUCTURED_RECEIVER =
  /\b(?:capabilities|emails|ids|indices|kinds|names|ordinals|tools|usernames)\.(?:contains|includes)\s*\(/u;

type Category =
  | "source_audit"
  | "structured_data_or_syntax"
  | "tool_description_search"
  | "user_literal_filter";

const isUnder = (relativePath: string, prefixes: readonly string[]): boolean =>
  prefixes.some((prefix) =>
    relativePath === prefix || relativePath.startsWith(`${prefix}/`)
  );

const rustCfgTestItemEnd = (source: string, itemStart: number): number => {
  let index = itemStart;
  let blockDepth = 0;
  let blockCommentDepth = 0;
  let lineComment = false;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let rawHashes: number | null = null;
  let bodyStarted = false;

  while (index < source.length) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (lineComment) {
      if (character === "\n") lineComment = false;
      index += 1;
      continue;
    }
    if (blockCommentDepth > 0) {
      if (character === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 2;
      } else if (character === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (rawHashes !== null) {
      if (
        character === '"'
        && source.slice(index + 1, index + 1 + rawHashes) === "#".repeat(rawHashes)
      ) {
        index += rawHashes + 1;
        rawHashes = null;
      }
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 2;
      continue;
    }
    if (character === "/" && next === "*") {
      blockCommentDepth = 1;
      index += 2;
      continue;
    }
    if (character === "r" || (character === "b" && next === "r")) {
      const rawStart = character === "r" ? index + 1 : index + 2;
      let cursor = rawStart;
      while (source[cursor] === "#") cursor += 1;
      if (source[cursor] === '"') {
        rawHashes = cursor - rawStart;
        index = cursor + 1;
        continue;
      }
    }
    const charLiteral =
      character === "'"
      && (
        (next !== "\\" && source[index + 2] === "'")
        || (next === "\\" && source[index + 3] === "'")
      );
    if (character === '"' || charLiteral) {
      quote = character as '"' | "'";
      index += 1;
      continue;
    }
    if (character === ";" && !bodyStarted) {
      return index + 1;
    }
    if (character === "{") {
      bodyStarted = true;
      blockDepth += 1;
    } else if (character === "}" && bodyStarted) {
      blockDepth -= 1;
      if (blockDepth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return source.length;
};

const stripRustCfgTestItems = (source: string): string => {
  const ranges: Array<{ readonly start: number; readonly end: number }> = [];
  const attribute = /#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]/gu;
  for (const match of source.matchAll(attribute)) {
    const start = match.index;
    const itemStart = start + match[0].length;
    ranges.push({ start, end: rustCfgTestItemEnd(source, itemStart) });
  }
  if (ranges.length === 0) {
    return source;
  }
  let cursor = 0;
  let output = "";
  for (const range of ranges) {
    if (range.start < cursor) continue;
    output += source.slice(cursor, range.start);
    output += source.slice(range.start, range.end).replace(/[^\r\n]/gu, " ");
    cursor = range.end;
  }
  return output + source.slice(cursor);
};

const productionSource = (relativePath: string, source: string): string => {
  if (path.extname(relativePath) !== ".rs") {
    return source;
  }
  return stripRustCfgTestItems(source);
};

const verifyCfgTestStripping = (): void => {
  const fixture = `
fn production_before() {}

#[cfg(test)]
mod tests {
  #[test]
  fn ignored_test_body() {
    let prompt = "demo";
    assert!(prompt.contains("demo"));
  }
}

fn production_after(prompt: &str) -> bool {
  prompt.contains("demo")
}
`;
  const production = productionSource("fixture.rs", fixture);
  if (
    production.includes("ignored_test_body")
    || !production.includes("production_after")
    || !NATURAL_LANGUAGE_RECEIVER.test(
      production.split(/\r?\n/u).find((line) => line.includes('prompt.contains("demo")')) ?? ""
    )
  ) {
    throw new Error("cfg(test) stripping self-test failed");
  }
};

const walk = (relativeRoot: string): string[] => {
  const absoluteRoot = path.join(ROOT, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
    const relativePath = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_SEGMENTS.has(entry.name)) {
        files.push(...walk(relativePath));
      }
      continue;
    }
    if (
      SOURCE_EXTENSIONS.has(path.extname(entry.name))
      && !/\.(?:spec|test)\.[^.]+$/u.test(entry.name)
    ) {
      files.push(relativePath);
    }
  }
  return files;
};

const classify = (
  relativePath: string,
  line: string,
  context: string
): Category | null => {
  if (isUnder(relativePath, SOURCE_AUDIT_PATHS)) {
    return "source_audit";
  }
  if (isUnder(relativePath, TOOL_DESCRIPTION_SEARCH_PATHS)) {
    return "tool_description_search";
  }
  if (
    isUnder(relativePath, USER_LITERAL_FILTER_PATHS)
    && /(?:matchesLabelIncludes|labelIncludes|nameIncludes|pattern|query|request\.text|waitForSelector|waitUntil)/u.test(context)
  ) {
    return "user_literal_filter";
  }
  if (
    REGEX_SYNTAX_PATHS.has(relativePath)
    && /(?:Regex::new|RegexBuilder::new|new RegExp|\.match)\s*\(/u.test(line)
  ) {
    return "structured_data_or_syntax";
  }
  if (isUnder(relativePath, STRUCTURED_PROTOCOL_PATHS)) {
    return "structured_data_or_syntax";
  }
  if (COLLECTION_MEMBERSHIP.test(line) || STRUCTURED_CONTEXT.test(context)) {
    return "structured_data_or_syntax";
  }
  return null;
};

const violations: string[] = [];
const counts: Record<Category, number> = {
  source_audit: 0,
  structured_data_or_syntax: 0,
  tool_description_search: 0,
  user_literal_filter: 0
};
let inventoriedMatches = 0;
let scannedFiles = 0;

verifyCfgTestStripping();

for (const relativePath of ROOTS.flatMap(walk)) {
  const source = productionSource(
    relativePath,
    fs.readFileSync(path.join(ROOT, relativePath), "utf8")
  );
  scannedFiles += 1;
  const lines = source.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const matches = [...line.matchAll(MATCH_SITE)];
    if (matches.length === 0) {
      continue;
    }
    inventoriedMatches += matches.length;
    const context = lines
      .slice(Math.max(0, index - 2), Math.min(lines.length, index + 3))
      .join("\n");
    const category = classify(relativePath, line, context);
    const regexSyntaxSite =
      REGEX_SYNTAX_PATHS.has(relativePath)
      && /(?:Regex::new|RegexBuilder::new|new RegExp|\.match)\s*\(/u.test(line);
    const allowedNaturalLanguageBoundary =
      category === "source_audit"
      || category === "tool_description_search"
      || category === "user_literal_filter"
      || regexSyntaxSite
      || STRUCTURED_RECEIVER.test(line)
      || STRUCTURED_RECEIVER_ARGUMENT.test(line);
    if (
      (!allowedNaturalLanguageBoundary && NATURAL_LANGUAGE_RECEIVER.test(line))
      || NATURAL_LANGUAGE_REGEX.test(context)
    ) {
      violations.push(
        `${relativePath}:${index + 1} natural-language semantic classification`
      );
      continue;
    }
    if (category === null) {
      violations.push(`${relativePath}:${index + 1} unclassified text-match site`);
      continue;
    }
    counts[category] += matches.length;
  }
}

if (violations.length > 0) {
  console.error("\n[Natural-Language Semantics Guard] Violations found:\n");
  for (const violation of violations.slice(0, 200)) {
    console.error(`- ${violation}`);
  }
  if (violations.length > 200) {
    console.error(`- ... ${violations.length - 200} more`);
  }
  console.error(
    "\nUse structured contracts, typed errors, protocol/syntax identifiers, explicit user literal filters, Tool-FS description search, or source-audit rules."
  );
  process.exit(1);
}

console.log(
  `[natural-language-semantics] OK - scanned ${scannedFiles} production files and classified ${inventoriedMatches} text-match sites: ${JSON.stringify(counts)}`
);
