import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ResponsibilityCluster = {
  readonly id: string;
  readonly pattern: RegExp;
};

type HotspotBudget = {
  readonly reason: string;
  readonly maxSourceLines: number;
  readonly maxDimensions: number;
  readonly maxImports: number;
  readonly maxStatefulRefs: number;
  readonly maxHostRefs: number;
  readonly maxControlFlowRefs: number;
};

type SourceMetrics = {
  readonly file: string;
  readonly ext: string;
  readonly sourceLines: number;
  readonly imports: number;
  readonly importFamilies: number;
  readonly statefulRefs: number;
  readonly effectRefs: number;
  readonly hostRefs: number;
  readonly controlFlowRefs: number;
  readonly publicRuntimeExports: number;
  readonly publicTypeExports: number;
  readonly responsibilityClusters: readonly string[];
  readonly pureContract: boolean;
  readonly dimensions: readonly string[];
  readonly hotspot: boolean;
};

const ROOT = process.cwd();
const SCAN_ROOTS = ["apps/desktop/src", "services", "packages", "crates", "tools"] as const;
const SOURCE_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".rs"]);
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  "target",
  ".venv",
  ".next",
  "out"
]);
const IGNORE_FILE_PATTERNS = [
  /\/tests?\//,
  /\/__fixtures__\//,
  /\/fixtures\//,
  /\.test\./,
  /\.spec\./,
  /\.d\.ts$/
];

const TS_SOFT_SOURCE_LINES = 650;
const TS_HARD_SOURCE_LINES = 1150;
const RUST_SOFT_SOURCE_LINES = 900;
const RUST_HARD_SOURCE_LINES = 1700;

const RESPONSIBILITY_CLUSTERS: readonly ResponsibilityCluster[] = [
  {
    id: "browser-observation",
    pattern: /\b(browser|page|dom|lumen|webContents|semantic|snapshot|accessibility)\b/i
  },
  {
    id: "input-targeting",
    pattern: /\b(input|keyboard|mouse|focus|scroll|locator|target|element)\b/i
  },
  {
    id: "navigation",
    pattern: /\b(navigation|history|reload|route|url|address)\b/i
  },
  {
    id: "policy-security",
    pattern: /\b(elevation|permission|approval|policy|security|secret|sensitive)\b/i
  },
  {
    id: "tool-dispatch",
    pattern: /\b(tool|dispatch|dispatcher|execute|executor|native|host|artifact|timeout|cancel)\b/i
  },
  {
    id: "download-transport",
    pattern: /\b(download|aria2|curl|http|transport|persistence|queue|remote)\b/i
  },
  {
    id: "state-runtime",
    pattern: /\b(state|store|cache|session|runtime|manager|controller|registry)\b/i
  },
  {
    id: "ui-surface",
    pattern: /\b(view|surface|panel|tab|toolbar|dialog|notification|settings)\b/i
  },
  {
    id: "file-workspace",
    pattern: /\b(file|directory|path|workspace|project|document)\b/i
  },
  {
    id: "terminal-process",
    pattern: /\b(terminal|pty|screen|pane|command|process)\b/i
  },
  {
    id: "search-index",
    pattern: /\b(search|query|index|result|rank)\b/i
  },
  {
    id: "identity-login",
    pattern: /\b(login|password|credential|vault|account|auth)\b/i
  }
];

const HOTSPOT_BASELINE: Record<string, HotspotBudget> = {
  "apps/desktop/src/main/index.ts": {
    reason: "Existing Electron bootstrap composition root; must stay wiring-only and shrink over time.",
    maxSourceLines: 1445,
    maxDimensions: 6,
    maxImports: 40,
    maxStatefulRefs: 2,
    maxHostRefs: 35,
    maxControlFlowRefs: 153
  },
  "apps/desktop/src/modules/workbench/shell/index.tsx": {
    reason: "Existing Workbench composition shell; UI style guard also caps it at 800 physical lines.",
    maxSourceLines: 780,
    maxDimensions: 6,
    maxImports: 60,
    maxStatefulRefs: 32,
    maxHostRefs: 40,
    maxControlFlowRefs: 12
  },
  "apps/desktop/src/modules/workbench/ai-panel/use-lyra-agent-data-provider.ts": {
    reason: "Existing bridge-heavy Agent data provider; future features must move into focused adapters.",
    maxSourceLines: 1801,
    maxDimensions: 6,
    maxImports: 26,
    maxStatefulRefs: 75,
    maxHostRefs: 140,
    maxControlFlowRefs: 190
  },
  "apps/desktop/src/preload/index.ts": {
    reason: "Existing preload bridge registration surface; additions must move to focused bridge modules.",
    maxSourceLines: 1796,
    maxDimensions: 3,
    maxImports: 5,
    maxStatefulRefs: 13,
    maxHostRefs: 5,
    maxControlFlowRefs: 71
  },
  "apps/desktop/src/main/workbench-browser/view-manager-runtime/agent-observation-engine.ts": {
    reason: "Existing browser observation engine hotspot; split observation stages before growing.",
    maxSourceLines: 1595,
    maxDimensions: 3,
    maxImports: 14,
    maxStatefulRefs: 8,
    maxHostRefs: 0,
    maxControlFlowRefs: 84
  },
  "apps/desktop/src/main/workbench-browser/view-manager-runtime/ax-controller.ts": {
    reason: "Existing accessibility controller hotspot; split detectors and mutation handling before growing.",
    maxSourceLines: 1463,
    maxDimensions: 3,
    maxImports: 9,
    maxStatefulRefs: 5,
    maxHostRefs: 1,
    maxControlFlowRefs: 139
  },
  "apps/desktop/src/modules/workbench/settings-ai/view.tsx": {
    reason: "Existing AI settings surface hotspot; split models, skills, and MCP panels before growing.",
    maxSourceLines: 2174,
    maxDimensions: 4,
    maxImports: 9,
    maxStatefulRefs: 61,
    maxHostRefs: 2,
    maxControlFlowRefs: 108
  },
  "crates/lyra-agent-plugins/src/lib.rs": {
    reason: "Existing plugin crate root; registration and runtime behavior should split before growing.",
    maxSourceLines: 1660,
    maxDimensions: 5,
    maxImports: 7,
    maxStatefulRefs: 35,
    maxHostRefs: 1,
    maxControlFlowRefs: 45
  },
  "crates/lyra-image-core/src/lib.rs": {
    reason: "Existing image core crate root; decoding and model concerns should split before growing.",
    maxSourceLines: 2193,
    maxDimensions: 4,
    maxImports: 20,
    maxStatefulRefs: 10,
    maxHostRefs: 1,
    maxControlFlowRefs: 120
  },
  "crates/lyra-bootstrap-core/src/projection.rs": {
    reason: "Core projection transaction and rollback path; split marker, registry, and filesystem responsibilities before further growth.",
    maxSourceLines: 1701,
    maxDimensions: 3,
    maxImports: 24,
    maxStatefulRefs: 1,
    maxHostRefs: 0,
    maxControlFlowRefs: 112
  },
  "crates/lyra-agent-runtime/src/native_backend/tools/web.rs": {
    reason: "Existing web native tool module; request, parsing, and projection paths should split before growing.",
    maxSourceLines: 1965,
    maxDimensions: 3,
    maxImports: 4,
    maxStatefulRefs: 9,
    maxHostRefs: 1,
    maxControlFlowRefs: 130
  },
  "services/browser-automation/src/modules/cdp_inspector/index.ts": {
    reason: "Existing CDP inspector service root; protocol parsing and inspection flows must split before growing.",
    maxSourceLines: 840,
    maxDimensions: 4,
    maxImports: 2,
    maxStatefulRefs: 5,
    maxHostRefs: 1,
    maxControlFlowRefs: 90
  },
  "crates/lyra-agent-runtime/src/native_backend/activity.rs": {
    reason: "Existing native backend activity hotspot; split event emission and activity state before growing.",
    maxSourceLines: 1840,
    maxDimensions: 3,
    maxImports: 1,
    maxStatefulRefs: 1,
    maxHostRefs: 0,
    maxControlFlowRefs: 150
  },
  "crates/lyra-agent-runtime/src/native_backend/tools/file.rs": {
    reason: "Existing native file tool hotspot; split file operations by domain before growing.",
    maxSourceLines: 2351,
    maxDimensions: 3,
    maxImports: 3,
    maxStatefulRefs: 3,
    maxHostRefs: 0,
    maxControlFlowRefs: 186
  },
  "crates/lyra-tool-fs-core/src/catalog.rs": {
    reason: "Existing Tool-FS catalog hotspot; split tool families before growing.",
    maxSourceLines: 2589,
    maxDimensions: 3,
    maxImports: 6,
    maxStatefulRefs: 0,
    maxHostRefs: 0,
    maxControlFlowRefs: 96
  }
};

const toRelativePath = (absolutePath: string): string =>
  path.relative(ROOT, absolutePath).split(path.sep).join("/");

const toAbsolutePath = (relativePath: string): string => path.join(ROOT, relativePath);

const walkSourceFiles = (rootRelativePath: string, output: string[] = []): string[] => {
  const absoluteRoot = toAbsolutePath(rootRelativePath);
  if (fs.existsSync(absoluteRoot) === false) {
    return output;
  }
  const entries = fs.readdirSync(absoluteRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) {
      continue;
    }
    const absoluteEntry = path.join(absoluteRoot, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(toRelativePath(absoluteEntry), output);
      continue;
    }
    const relativeEntry = toRelativePath(absoluteEntry);
    if (SOURCE_EXT.has(path.extname(entry.name)) && shouldScanFile(relativeEntry)) {
      output.push(relativeEntry);
    }
  }
  return output;
};

const shouldScanFile = (relativePath: string): boolean =>
  IGNORE_FILE_PATTERNS.every((pattern) => pattern.test(relativePath) === false);

const countMatches = (text: string, pattern: RegExp): number =>
  text.match(pattern)?.length ?? 0;

const sourceLineCount = (text: string): number =>
  text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0
        && trimmed.startsWith("//") === false
        && trimmed.startsWith("*") === false
        && trimmed.startsWith("#[") === false;
    })
    .length;

const moduleImportFamilies = (imports: readonly string[]): number => {
  const families = new Set<string>();
  for (const moduleSpecifier of imports) {
    const normalized = moduleSpecifier
      .replace(/^\.\.?\//, "")
      .replace(/^node:/, "node")
      .replace(/^@([^/]+)\/([^/]+).*/u, "@$1/$2");
    const family = normalized.split(/[/{:]/u)[0] ?? "";
    if (family.length > 0) {
      families.add(family);
    }
  }
  return families.size;
};

const collectImports = (text: string): string[] =>
  [
    ...text.matchAll(/from\s+["']([^"']+)["']/g),
    ...text.matchAll(/import\s+["']([^"']+)["']/g),
    ...text.matchAll(/^\s*use\s+([^;]+);/gm)
  ].flatMap((match) => {
    const value = match[1]?.trim();
    return value === undefined || value.length === 0 ? [] : [value];
  });

const publicRuntimeExportCount = (text: string, ext: string): number =>
  ext === ".rs"
    ? countMatches(text, /\bpub\s+(?:async\s+)?fn\b/g)
    : countMatches(text, /\bexport\s+(?:const|function|class|enum)\b/g);

const publicTypeExportCount = (text: string, ext: string): number =>
  ext === ".rs"
    ? countMatches(text, /\bpub\s+(?:struct|enum|type|trait)\b/g)
    : countMatches(text, /\bexport\s+(?:type|interface)\b/g);

const responsibilityClusters = (text: string): string[] =>
  RESPONSIBILITY_CLUSTERS
    .filter((cluster) => cluster.pattern.test(text))
    .map((cluster) => cluster.id);

const isRootModule = (relativePath: string): boolean =>
  /\/(?:index\.tsx?|mod\.rs|lib\.rs)$/u.test(`/${relativePath}`);

const softLineLimit = (ext: string): number =>
  ext === ".rs" ? RUST_SOFT_SOURCE_LINES : TS_SOFT_SOURCE_LINES;

const hardLineLimit = (ext: string): number =>
  ext === ".rs" ? RUST_HARD_SOURCE_LINES : TS_HARD_SOURCE_LINES;

const analyzeSource = (relativePath: string): SourceMetrics => {
  const text = fs.readFileSync(toAbsolutePath(relativePath), "utf8");
  const ext = path.extname(relativePath);
  const imports = collectImports(text);
  const statefulRefs =
    countMatches(text, /\buse(?:State|Reducer|Ref)\s*\(/g)
    + countMatches(text, /\bnew\s+(?:Map|Set)\b/g)
    + countMatches(text, /\b(?:Arc|Mutex|RwLock|HashMap|HashSet|OnceLock|RefCell|Cell)</g);
  const effectRefs = countMatches(text, /\buse(?:Effect|LayoutEffect|Memo|Callback)\s*\(/g);
  const hostRefs = countMatches(
    text,
    /\bdesktopApi\b|\bgetDesktopApi\b|\blyraDesktop\b|\bruntimeClient\b|from\s+["']electron["']|from\s+["']node:|\bWebContents\b|\bipcMain\b|\bsafeStorage\b/g
  );
  const controlFlowRefs = countMatches(
    text,
    /\b(?:if|switch|for|while|try|catch|match|loop)\b/g
  );
  const publicRuntimeExports = publicRuntimeExportCount(text, ext);
  const publicTypeExports = publicTypeExportCount(text, ext);
  const clusters = responsibilityClusters(text);
  const sourceLines = sourceLineCount(text);
  const pureContract =
    publicTypeExports >= 20
    && publicRuntimeExports <= 6
    && statefulRefs <= 3
    && effectRefs === 0
    && hostRefs <= 4
    && controlFlowRefs <= 20;
  const dimensions = [
    sourceLines >= softLineLimit(ext) ? "size" : null,
    imports.length >= 18 || moduleImportFamilies(imports) >= 13 ? "dependency-breadth" : null,
    statefulRefs + effectRefs >= 16 ? "stateful-runtime" : null,
    hostRefs >= 25 ? "host-coupling" : null,
    clusters.length >= 9 ? "responsibility-breadth" : null,
    controlFlowRefs >= 75 ? "control-flow" : null,
    publicRuntimeExports >= 18 ? "wide-runtime-api" : null,
    isRootModule(relativePath) && sourceLines >= 280 && !pureContract ? "root-implementation" : null
  ].filter((dimension): dimension is string => dimension !== null);
  const dimensionsWithoutSize = dimensions.filter((dimension) => dimension !== "size");
  const hotspot = !pureContract && (
    (sourceLines >= hardLineLimit(ext) && dimensionsWithoutSize.length >= 2)
    || (sourceLines >= softLineLimit(ext) && dimensionsWithoutSize.length >= 4)
    || (
      isRootModule(relativePath)
      && sourceLines >= 280
      && dimensionsWithoutSize.length >= 3
    )
  );
  return {
    file: relativePath,
    ext,
    sourceLines,
    imports: imports.length,
    importFamilies: moduleImportFamilies(imports),
    statefulRefs,
    effectRefs,
    hostRefs,
    controlFlowRefs,
    publicRuntimeExports,
    publicTypeExports,
    responsibilityClusters: clusters,
    pureContract,
    dimensions,
    hotspot
  };
};

const metricSummary = (metrics: SourceMetrics): string =>
  [
    `${metrics.sourceLines} source lines`,
    `${metrics.imports} imports`,
    `${metrics.statefulRefs + metrics.effectRefs} state/effect refs`,
    `${metrics.hostRefs} host refs`,
    `${metrics.controlFlowRefs} control-flow refs`,
    `dimensions=${metrics.dimensions.join(",")}`
  ].join("; ");

const baselineViolations = (
  metrics: SourceMetrics,
  budget: HotspotBudget
): string[] => {
  const checks: readonly [string, number, number][] = [
    ["source lines", metrics.sourceLines, budget.maxSourceLines],
    ["architecture dimensions", metrics.dimensions.length, budget.maxDimensions],
    ["imports", metrics.imports, budget.maxImports],
    ["state/effect refs", metrics.statefulRefs + metrics.effectRefs, budget.maxStatefulRefs],
    ["host refs", metrics.hostRefs, budget.maxHostRefs],
    ["control-flow refs", metrics.controlFlowRefs, budget.maxControlFlowRefs]
  ];
  return checks.flatMap(([label, actual, max]) =>
    actual > max ? [`${metrics.file} exceeds registered hotspot ${label} budget (${actual} > ${max}). Split the new responsibility before landing.`] : []
  );
};

export const runArchitectureHealthGuard = (): string[] => {
  const violations: string[] = [];
  const files = SCAN_ROOTS.flatMap((root) => walkSourceFiles(root));
  const metricsByPath = new Map(files.map((file) => [file, analyzeSource(file)]));

  for (const [file, budget] of Object.entries(HOTSPOT_BASELINE)) {
    if (budget.reason.trim().length < 30) {
      violations.push(`${file} hotspot baseline reason is too short; explain the architectural debt and expected split.`);
    }
    if (metricsByPath.has(file) === false) {
      violations.push(`${file} has a stale architecture hotspot baseline entry. Remove the baseline entry.`);
    }
  }

  for (const metrics of metricsByPath.values()) {
    const budget = HOTSPOT_BASELINE[metrics.file];
    if (!metrics.hotspot) {
      if (budget !== undefined) {
        violations.push(`${metrics.file} no longer qualifies as an architecture hotspot. Remove its baseline entry.`);
      }
      continue;
    }
    if (budget === undefined) {
      violations.push(
        `${metrics.file} is an unregistered architecture hotspot (${metricSummary(metrics)}). Split by responsibility, or add a temporary no-growth baseline only after architecture review.`
      );
      continue;
    }
    violations.push(...baselineViolations(metrics, budget));
  }

  return violations;
};

const main = (): void => {
  const violations = runArchitectureHealthGuard();
  if (violations.length > 0) {
    console.error("\n[Lyra Architecture Health Guard] Violations found:\n");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exit(1);
  }
  console.log("[Lyra Architecture Health Guard] OK");
};

if (
  process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
