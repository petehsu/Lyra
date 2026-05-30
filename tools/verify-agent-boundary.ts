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

const workspaceManifestPath = path.join(ROOT, "Cargo.toml");
if (fs.existsSync(workspaceManifestPath)) {
  const manifest = fs.readFileSync(workspaceManifestPath, "utf8");
  if (/lyra-agent-legacy-|jcode-[\w-]*/.test(manifest)) {
    violations.push("Cargo.toml workspace must not include removed legacy Agent or jcode crates.");
  }
}

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
      if (/(?:jcode_core\/vendor\/root_src|root_src|kernel_legacy)/.test(line) && fileRel.startsWith("apps/desktop/src/")) {
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

const lyradManifestPath = path.join(ROOT, "crates/lyrad/Cargo.toml");
if (fs.existsSync(lyradManifestPath)) {
  const manifest = fs.readFileSync(lyradManifestPath, "utf8");
  if (/^\s*lyra-agent-core\s*=.*/m.test(manifest)) {
    violations.push("crates/lyrad/Cargo.toml daemon must depend on lyra-agent-runtime, not lyra-agent-core directly.");
  }
  if (!/^\s*lyra-agent-runtime\s*=.*/m.test(manifest)) {
    violations.push("crates/lyrad/Cargo.toml daemon must route Agent requests through lyra-agent-runtime.");
  }
}

const runtimeManifestPath = path.join(ROOT, "crates/lyra-agent-runtime/Cargo.toml");
if (fs.existsSync(runtimeManifestPath)) {
  const manifest = fs.readFileSync(runtimeManifestPath, "utf8");
  if (/^\s*lyra-agent-core\s*=.*/m.test(manifest)) {
    violations.push("crates/lyra-agent-runtime/Cargo.toml runtime must not depend on lyra-agent-core.");
  }
  if (/^\s*lyra-agent-legacy-kernel\s*=.*/m.test(manifest)) {
    violations.push("crates/lyra-agent-runtime/Cargo.toml runtime must not depend on lyra-agent-legacy-kernel.");
  }
  if (/^\s*lyra-agent-legacy-adapter\s*=.*/m.test(manifest)) {
    violations.push("crates/lyra-agent-runtime/Cargo.toml runtime must not depend on lyra-agent-legacy-adapter.");
  }
  if (/^\s*jcode-[\w-]*\s*=.*/m.test(manifest)) {
    violations.push("crates/lyra-agent-runtime/Cargo.toml runtime must not depend on jcode-* crates.");
  }
}

const coreManifestPath = path.join(ROOT, "crates/lyra-agent-core/Cargo.toml");
if (fs.existsSync(coreManifestPath)) {
  const manifest = fs.readFileSync(coreManifestPath, "utf8");
  if (/^\s*lyra-agent-legacy-kernel\s*=.*/m.test(manifest)) {
    violations.push("crates/lyra-agent-core/Cargo.toml core facade must not depend on lyra-agent-legacy-kernel directly.");
  }
  if (/^\s*lyra-agent-legacy-adapter\s*=.*/m.test(manifest)) {
    violations.push("crates/lyra-agent-core/Cargo.toml core facade must not depend on lyra-agent-legacy-adapter.");
  }
}

for (const relativePath of [
  "crates/lyra-agent-core/src/jcode_core/vendor",
  "crates/lyra-agent-legacy-adapter",
  "crates/lyra-agent-legacy-kernel",
  "crates/lyra-agent-legacy-kernel-crates"
]) {
  if (fs.existsSync(path.join(ROOT, relativePath))) {
    violations.push(`${relativePath} must not exist; Agent runtime must use Lyra-native crates only.`);
  }
}

const coreLegacyKernelFile = path.join(ROOT, "crates/lyra-agent-core/src/kernel_legacy.rs");
if (fs.existsSync(coreLegacyKernelFile)) {
  violations.push("crates/lyra-agent-core/src/kernel_legacy.rs must not exist; legacy kernel source belongs in crates/lyra-agent-legacy-kernel.");
}

const coreLegacyKernelDir = path.join(ROOT, "crates/lyra-agent-core/src/kernel_legacy");
if (fs.existsSync(coreLegacyKernelDir)) {
  violations.push("crates/lyra-agent-core/src/kernel_legacy must not exist; legacy kernel source belongs in crates/lyra-agent-legacy-kernel.");
}

const cratesDir = path.join(ROOT, "crates");
if (fs.existsSync(cratesDir)) {
  for (const crateName of fs.readdirSync(cratesDir)) {
    const manifestPath = path.join(cratesDir, crateName, "Cargo.toml");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = fs.readFileSync(manifestPath, "utf8");
    if (/^\s*lyra-agent-legacy-(?:adapter|kernel)\s*=.*/m.test(manifest)) {
      violations.push(`${rel(manifestPath)} must not depend on removed legacy Agent crates.`);
    }
    if (/^\s*jcode-[\w-]*\s*=.*/m.test(manifest)) {
      violations.push(`${rel(manifestPath)} must not depend on jcode-* crates.`);
    }
  }
}

const legacyBridgePath = path.join(ROOT, "crates/lyra-agent-core/src/lyra_runtime/legacy_bridge.rs");
if (fs.existsSync(legacyBridgePath)) {
  const source = fs.readFileSync(legacyBridgePath, "utf8");
  if (/crate::(?:agent|memory|provider|session|tool|auth|config|message|protocol|storage|todo)::/.test(source)) {
    violations.push("crates/lyra-agent-core/src/lyra_runtime/legacy_bridge.rs must not access legacy modules directly.");
  }
}

const desktopPackagePath = path.join(ROOT, "apps/desktop/package.json");
if (fs.existsSync(desktopPackagePath)) {
  const manifest = fs.readFileSync(desktopPackagePath, "utf8");
  if (/lyra-agent-legacy-adapter/.test(manifest)) {
    violations.push("apps/desktop/package.json Desktop must not depend on lyra-agent-legacy-adapter.");
  }
}

if (violations.length > 0) {
  console.error("\n[Lyra Agent Boundary Guard] Violations found:\n");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("[Lyra Agent Boundary Guard] OK");
