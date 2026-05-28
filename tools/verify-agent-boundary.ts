import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".rs"]);
const SCAN_ROOTS = [
  "apps/desktop/src",
  "crates/lyrad/src",
  "crates/lyrad/tests"
];
const IGNORE_DIRS = new Set(["node_modules", "dist", "coverage", "target", ".git"]);

const violations: string[] = [];

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, out);
    } else if (SOURCE_EXT.has(path.extname(entry.name))) {
      out.push(absolute);
    }
  }
  return out;
}

function rel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

for (const root of SCAN_ROOTS) {
  for (const file of walk(path.join(ROOT, root))) {
    const fileRel = rel(file);
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/\bJcode\b|\bJcode[A-Z_]/.test(line)) {
        violations.push(`${fileRel}:${index + 1} Desktop/daemon public contracts must use Agent names, not Jcode names.`);
      }
      if (/\bjcode\./.test(line) || /lyra:jcode\//.test(line)) {
        violations.push(`${fileRel}:${index + 1} Runtime methods and IPC channels must use agent.* / lyra:agent/... names.`);
      }
      if (/jcode_core\/vendor\/root_src|root_src/.test(line) && fileRel.startsWith("apps/desktop/src/")) {
        violations.push(`${fileRel}:${index + 1} Desktop must not reference legacy kernel paths.`);
      }
    });
  }
}

const routerPath = path.join(ROOT, "crates/lyrad/src/router.rs");
if (fs.existsSync(routerPath)) {
  const router = fs.readFileSync(routerPath, "utf8");
  if (/starts_with\("jcode\."\)|handle_jcode_request|unknown_method\("jcode"/.test(router)) {
    violations.push("crates/lyrad/src/router.rs daemon router must not expose jcode.* methods.");
  }
}

if (violations.length > 0) {
  console.error("\n[Lyra Agent Boundary Guard] Violations found:\n");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("[Lyra Agent Boundary Guard] OK");
