import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const libPath = path.join(ROOT, "crates/lyra-agent-core/src/lib.rs");
const bridgePath = path.join(ROOT, "apps/desktop/src/shared/desktop-bridge.ts");
const agentTypesPath = path.join(ROOT, "apps/desktop/src/shared/agent.ts");
const violations: string[] = [];

function lines(file: string): readonly string[] {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
}

function publicUseWithoutAliasedLegacy(line: string): string {
  return line.replace(/\b[A-Za-z0-9_]*jcode[A-Za-z0-9_]*\s+as\s+[A-Za-z0-9_]+/g, "");
}

lines(libPath).forEach((line, index) => {
  if (/pub\s+mod\s+jcode|pub\s+mod\s+\w+;.*root_src/.test(line)) {
    violations.push(`crates/lyra-agent-core/src/lib.rs:${index + 1} Public modules must not expose legacy jcode/root_src internals.`);
  }
  if (/^pub\s+mod\s+/.test(line) && /jcode_core\/vendor\/root_src/.test(line)) {
    violations.push(`crates/lyra-agent-core/src/lib.rs:${index + 1} root_src modules must remain private.`);
  }
  if (/^\s*(pub\s+use|[A-Za-z0-9_]+,)/.test(line)) {
    const visible = publicUseWithoutAliasedLegacy(line);
    if (/\bjcode\b|\bjcode[A-Za-z0-9_]*|Jcode/.test(visible)) {
      violations.push(`crates/lyra-agent-core/src/lib.rs:${index + 1} Public exports must use Lyra Agent names.`);
    }
  }
});

for (const [file, label] of [
  [bridgePath, "apps/desktop/src/shared/desktop-bridge.ts"],
  [agentTypesPath, "apps/desktop/src/shared/agent.ts"]
] as const) {
  lines(file).forEach((line, index) => {
    if (/Jcode|jcode\.|lyra:jcode\//.test(line)) {
      violations.push(`${label}:${index + 1} Shared Desktop contracts must not expose jcode names.`);
    }
  });
}

if (violations.length > 0) {
  console.error("\n[Lyra No Jcode Public API Guard] Violations found:\n");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("[Lyra No Jcode Public API Guard] OK");
