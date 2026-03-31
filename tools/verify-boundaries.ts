import fs from "node:fs";
import path from "node:path";

type ImportRule = {
  readonly fromPrefix: string;
  readonly disallowPrefix: string;
  readonly message: string;
};

type ForbiddenFileRule = {
  readonly relativePath: string;
  readonly message: string;
};

type ForbiddenPatternRule = {
  readonly scopePrefix: string;
  readonly pattern: RegExp;
  readonly message: string;
  readonly excludePathPattern?: RegExp;
};

type ForbiddenDependencyRule = {
  readonly packageName: string;
  readonly message: string;
};

const ROOT = process.cwd();
const SOURCE_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".py", ".rs"]);
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "coverage", "target", ".venv"]);
const SCAN_ROOTS = ["apps", "services", "packages", "crates", "tools"];

const importRules: readonly ImportRule[] = [
  {
    fromPrefix: "apps/desktop/src",
    disallowPrefix: "services/",
    message: "Desktop app must not import service internals directly; use contracts/protocol boundary."
  },
  {
    fromPrefix: "services/control-plane/src",
    disallowPrefix: "apps/",
    message: "Control plane must not import app layer."
  },
  {
    fromPrefix: "services/browser-automation/src",
    disallowPrefix: "apps/",
    message: "Browser automation service must not import app layer."
  },
  {
    fromPrefix: "packages/plugin-sdk/src",
    disallowPrefix: "services/",
    message: "Plugin SDK must stay framework-agnostic; do not import service internals."
  },
  {
    fromPrefix: "apps/desktop/src/modules/workbench/",
    disallowPrefix: "apps/desktop/src/main/",
    message:
      "Renderer workbench modules must not import Electron main-process modules directly; use shared desktop-bridge contracts."
  },
  {
    fromPrefix: "apps/desktop/src/main/",
    disallowPrefix: "apps/desktop/src/modules/workbench/",
    message:
      "Electron main-process modules must not import renderer workbench modules."
  }
];

const forbiddenFileRules: readonly ForbiddenFileRule[] = [
  {
    relativePath: "apps/desktop/src/modules/workbench/browser-tabs/service.ts",
    message:
      "Workspace tab lifecycle must live in workspace-tabs; do not reintroduce compatibility wrappers."
  },
  {
    relativePath: "apps/desktop/src/modules/workbench/browser-tabs/types.ts",
    message:
      "Workspace tab lifecycle types must live in workspace-tabs; do not alias through browser-tabs."
  }
];

const forbiddenPatternRules: readonly ForbiddenPatternRule[] = [
  {
    scopePrefix: "apps/desktop/src/",
    pattern: /from\s+["'][^"']*\/pretext(?:\/|["'])|import\s+["'][^"']*\/pretext(?:\/|["'])/,
    message:
      "Workbench source must not import from the local pretext reference repository. Use ai-panel/text-layout internalized modules only."
  },
  {
    scopePrefix: "apps/desktop/src/",
    pattern: /@chenglou\/pretext/,
    message:
      "Workbench source must not import @chenglou/pretext directly. Use ai-panel/text-layout internalized modules only."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/sidebar/composer.tsx",
    pattern: /\bscrollHeight\b/,
    message:
      "Sidebar composer height must be driven by ai-panel/text-layout service, not direct scrollHeight reads."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/",
    pattern: /\buseBrowserTabsModel\b/,
    message:
      "Use workspace-tabs service directly (`useWorkspaceTabsModel`); avoid compatibility lifecycle hooks."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/",
    pattern: /browser-tabs\/service/,
    message:
      "Do not import browser-tabs service internals. Lifecycle lives in workspace-tabs."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/",
    pattern: /browser-tabs\/types/,
    message:
      "Do not import browser-tabs lifecycle types. Use workspace-tabs types."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/mcp-center/view.tsx",
    pattern: /from\s+["']\.\/service["']/,
    message:
      "MCP view layer must not import service internals directly. Import selectors/types/view-panels only."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/skills-center/view.tsx",
    pattern: /from\s+["']\.\/service["']/,
    message:
      "Skills view layer must not import service internals directly. Import selectors/types/view-panels only."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/mcp-center/view-panels.tsx",
    pattern: /from\s+["']\.\/service["']/,
    message:
      "MCP panel components must stay presentational and must not import service internals."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/skills-center/view-panels.tsx",
    pattern: /from\s+["']\.\/service["']/,
    message:
      "Skills panel components must stay presentational and must not import service internals."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/mcp-center/service.tsx",
    pattern: /from\s+["']\.\/view(-panels)?["']/,
    message:
      "MCP service layer must not import renderer views."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/skills-center/service.tsx",
    pattern: /from\s+["']\.\/view(-panels)?["']/,
    message:
      "Skills service layer must not import renderer views."
  },
  {
    scopePrefix: "apps/desktop/src/main/mcp/service.ts",
    pattern: /Fall through to the existing TypeScript implementation/,
    message:
      "MCP main service must not keep TypeScript fallback branches once native ownership exists."
  },
  {
    scopePrefix: "apps/desktop/src/main/skills/service.ts",
    pattern: /Fall through to the existing TypeScript implementation/,
    message:
      "Skills main service must not keep TypeScript fallback branches once native ownership exists."
  },
  {
    scopePrefix: "apps/desktop/src/main/skills/service.ts",
    pattern: /\bfallbackCreate\b/,
    message:
      "Skills main service must not retain create fallback helpers after native refactor."
  },
  {
    scopePrefix: "apps/desktop/src/main/skills/service.ts",
    pattern: /\binstallBuiltins\b|\binstallDiscoveredSkills\b|\bpersistInstalled\b|\bfindInstalledSkill\b/,
    message:
      "Skills main service must stay as a thin bridge; install and storage mutation logic belongs in native."
  },
  {
    scopePrefix: "apps/desktop/src/main/mcp/service.ts",
    pattern: /\bruntimeByServerId\b|\bhandleByServerId\b|\bintrospectionByServerId\b/,
    message:
      "MCP runtime registry state must live in native, not in Electron main service maps."
  },
  {
    scopePrefix: "apps/desktop/src/main/mcp/service.ts",
    pattern: /\bstopRuntimeHandle\b|\bstartPersistedServer\b/,
    message:
      "MCP process lifecycle must stay in native; do not reintroduce TypeScript runtime handlers."
  },
  {
    scopePrefix: "apps/desktop/src/main/runtime/workbench-fs-port.ts",
    pattern: /\bprobePathFallback\b|\bcollectFilePathsFallback\b/,
    message:
      "Workbench FS port must stay native-backed only; do not reintroduce Node fallback helpers."
  },
  {
    scopePrefix: "apps/desktop/src/main/runtime/workbench-fs-port.ts",
    pattern: /from\s+["']node:fs["']/,
    message:
      "Workbench FS port must not depend on Node fs fallback implementation."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/computer/",
    pattern: /\bwindow\.lyraDesktop\b/,
    message:
      "AI computer renderer modules must not access window.lyraDesktop directly. Inject desktopApi via model/surface props."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/computer/view.tsx",
    pattern: /desktopApi\.systemImages\./,
    message:
      "AI computer view must not call systemImages bridge directly. Route through useAiComputerModel/service."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/computer/app-surface.tsx",
    pattern: /desktopApi\.systemImages\./,
    message:
      "AI computer app surfaces must not call systemImages bridge directly. Route through useAiComputerModel/service."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/computer/",
    pattern: /\blocalStorage\b|\bsessionStorage\b/,
    message:
      "AI computer session/system truth must not be persisted in renderer storage. Keep source of truth in native modules."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/",
    pattern: /\blocalStorage\b|\bsessionStorage\b/,
    excludePathPattern: /\/tests\//,
    message:
      "Workbench modules must not use browser storage directly. Use workbenchState bridge-backed storage adapters."
  },
  {
    scopePrefix: "apps/desktop/src/main/",
    pattern: /\bapp\.getPath\("userData"\)|\buserDataPath\b/,
    message:
      "Main-process modules must use the centralized storage roots resolver. Do not use app.getPath(\"userData\") or userDataPath plumbing."
  }
];

const forbiddenDependencyRules: readonly ForbiddenDependencyRule[] = [
  {
    packageName: "@chenglou/pretext",
    message:
      "Dependency @chenglou/pretext is forbidden in this repository. Keep text layout internalized under ai-panel/text-layout."
  }
];

const violations: string[] = [];

function walk(dir: string, out: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, out);
    } else {
      out.push(abs);
    }
  }
  return out;
}

function rel(abs: string): string {
  return path.relative(ROOT, abs).split(path.sep).join("/");
}

function checkImportBoundaries(file: string, content: string): void {
  const fileRel = rel(file);
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const m = line.match(/from\s+["']([^"']+)["']/) ?? line.match(/import\s+["']([^"']+)["']/);
    if (!m) continue;
    const spec = m[1];
    if (!spec || (!spec.startsWith(".") && !spec.startsWith("/"))) continue;

    const resolved = path.normalize(path.join(path.dirname(fileRel), spec)).split(path.sep).join("/");

    for (const rule of importRules) {
      if (fileRel.startsWith(rule.fromPrefix) && resolved.startsWith(rule.disallowPrefix)) {
        violations.push(`${fileRel}:${i + 1} ${rule.message} (import: ${spec})`);
      }
    }
  }
}

function checkForbiddenPatterns(file: string, content: string): void {
  const fileRel = rel(file);
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    for (const rule of forbiddenPatternRules) {
      if (fileRel.startsWith(rule.scopePrefix) === false) {
        continue;
      }
      if (rule.excludePathPattern !== undefined && rule.excludePathPattern.test(fileRel)) {
        continue;
      }
      if (rule.pattern.test(line) === false) {
        continue;
      }
      violations.push(`${fileRel}:${i + 1} ${rule.message}`);
    }
  }
}

const files = SCAN_ROOTS.flatMap((entry) => {
  const abs = path.join(ROOT, entry);
  if (!fs.existsSync(abs)) return [];
  return walk(abs);
}).filter((f) => SOURCE_EXT.has(path.extname(f)));

for (const rule of forbiddenFileRules) {
  const abs = path.join(ROOT, rule.relativePath);
  if (fs.existsSync(abs)) {
    violations.push(`${rule.relativePath} ${rule.message}`);
  }
}

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  checkImportBoundaries(file, content);
  checkForbiddenPatterns(file, content);
}

const dependencyFiles = [
  "package.json",
  "apps/desktop/package.json"
];

for (const relativePath of dependencyFiles) {
  const absolutePath = path.join(ROOT, relativePath);
  if (fs.existsSync(absolutePath) === false) {
    continue;
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  const parsed = JSON.parse(raw) as {
    readonly dependencies?: Record<string, string>;
    readonly devDependencies?: Record<string, string>;
    readonly optionalDependencies?: Record<string, string>;
    readonly peerDependencies?: Record<string, string>;
  };
  const dependencyMaps = [
    parsed.dependencies,
    parsed.devDependencies,
    parsed.optionalDependencies,
    parsed.peerDependencies
  ];

  for (const rule of forbiddenDependencyRules) {
    const hasForbiddenDependency = dependencyMaps.some((dependencyMap) =>
      dependencyMap !== undefined
      && Object.prototype.hasOwnProperty.call(dependencyMap, rule.packageName)
    );
    if (hasForbiddenDependency) {
      violations.push(`${relativePath} ${rule.message}`);
    }
  }
}

if (violations.length > 0) {
  console.error("\n[Lyra Structure Guard] Violations found:\n");
  for (const v of violations) console.error(`- ${v}`);
  process.exit(1);
}

console.log("[Lyra Structure Guard] OK");
