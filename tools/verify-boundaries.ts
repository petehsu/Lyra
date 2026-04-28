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
const SCAN_ROOTS = ["apps", "services", "packages", "crates", "tools", "crates/lyra-agent-core"];

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
  },
  {
    scopePrefix: "apps/desktop/src/",
    pattern: new RegExp([
      "\\bco" + "dexMethod\\b",
      "\\bcommandDecisionToCo" + "dex\\b",
      "\\bAgentToolOwner\\s*=\\s*[\"']co" + "dex",
      "toolOwner:\\s*[\"']co" + "dex[\"']",
      "\\bdroppedAsCo" + "dexOwnedCount\\b",
      "\\bCo" + "dex runtime unavailable\\b",
      "defaultProfileName=[\"']Co" + "dex[\"']"
    ].join("|")),
    message:
      "Desktop Agent integration must use Lyra Agent Core naming, not legacy compatibility naming."
  },
  {
    scopePrefix: "crates/lyrad/src/",
    pattern: new RegExp("\\bCO" + "DEX_REQUEST|\\bCO" + "DEX_EVENT"),
    message:
      "lyrad Agent runtime errors must use Lyra Agent error codes."
  },
  {
    scopePrefix: "crates/lyra-agent-core/",
    pattern: new RegExp([
      "thread\\/realtime",
      "\\bRealtimeConversation\\b",
      "\\bRealtimeVoice\\b",
      "\\bRealtimeOutputModality\\b",
      "\\bRealtimeVoicesList\\b",
      "\\bRealtimeAudioFrame\\b",
      "lyra-realtime-webrtc",
      "\\brealtime_conversation\\b",
      "\\bCo" + "dexHttpClient\\b",
      "\\bCo" + "dexRequestBuilder\\b",
      "\\bCo" + "dexAuth\\b",
      "\\bCo" + "dexErr\\b",
      "\\bCo" + "dexConversation\\b",
      "\\bCo" + "dexErrorInfo\\b",
      "\\bCo" + "dexCompactionEvent\\b",
      "\\bCo" + "dexHooks\\b",
      "\\bmanaged_by_co" + "dex\\b",
      "\\bCo" + "dexSandbox",
      "\\bCo" + "dexHome\\b",
      "\\bGuardian[A-Za-z_]*\\b",
      "\\bguardian_[A-Za-z0-9_]*\\b",
      "\\bGUARDIAN_[A-Z0-9_]+\\b",
      "\\blegacy_feature[A-Za-z0-9_]*\\b",
      "\\bLegacyFeature[A-Za-z0-9_]*\\b",
      "\\blegacy_notify[A-Za-z0-9_]*\\b",
      "\\bnotify_hook\\b",
      "\\blegacy_notify_argv\\b",
      "Stage::" + "Experimental",
      "\\bExperimental" + "Feature\\b",
      "experimental" + "Feature\\/",
      "\\bexperimental" + "Api\\b",
      "\\bExternal" + "Migration\\b",
      "\\bexternal_" + "migration\\b",
      "\\bExternal" + "ConfigMigration\\b",
      "\\bexternal_" + "config_" + "migration\\b",
      "\\bPrevent" + "IdleSleep\\b",
      "\\bprevent_" + "idle_sleep\\b",
      "\\bMemory" + "Tool\\b",
      "\\bStage::UnderDevelopment\\b",
      "\\bUnderDevelopment\\b",
      "\\bsuppress_unstable_features_warning\\b",
      "\\bunstable_features_warning_event\\b",
      "\\bexperimental_windows_sandbox\\b",
      "\\benable_experimental_windows_sandbox\\b",
      "\\bexperimental_instructions_file\\b",
      "\\bexperimental_environment\\b",
      "\\bexperimental_realtime",
      "\\bexperimental_network\\b",
      "\\bexperimental_bearer_token\\b",
      "\\bexperimental_use_profile\\b",
      "\\bexperimental_supported_tools\\b",
      "\\bexperimentalSupportedTools\\b",
      "\\breasoning_summary_format\\b",
      "\\bbeta_features_header\\b",
      "\\bx-lyra-beta-features\\b",
      "\\bexperimental_use_unified_exec_tool\\b",
      "\\bexperimental_use_freeform_apply_patch\\b"
    ].join("|")),
    excludePathPattern: /\/(schema\/json|schema\/typescript|models\.json|Cargo\.lock|deny\.toml)\b/,
    message:
      "Agent Core internals must use Lyra-owned names, not legacy compatibility symbols."
  },
  {
    scopePrefix: "apps/desktop/src/",
    pattern: /\bApp Connectors\b/,
    message:
      "Desktop must not expose App Connectors as an independent product surface; use Plugins, MCP, or Skills UI."
  },
  {
    scopePrefix: "crates/lyra-agent-core/",
    pattern: /used_fallback_model_metadata|model_info_from_slug|fallback model metadata|fallback metadata/,
    excludePathPattern: /\/(Cargo\.lock|deny\.toml)\b/,
    message:
      "Agent model resolution must use provider/protocol runtime metadata or fail clearly; generic fallback metadata is not allowed."
  },
  {
    scopePrefix: "crates/lyra-agent-core/",
    pattern: new RegExp("\\bCO" + "DEX_[A-Z0-9_]+\\b"),
    excludePathPattern: /\/(Cargo\.lock|deny\.toml)\b/,
    message:
      "Agent Core runtime/env/helper symbols must use LYRA_* names."
  },
  {
    scopePrefix: "crates/lyra-agent-core/",
    pattern: new RegExp([
      "Fast" + "Mode",
      "fast_" + "mode",
      "supports_" + "fast_mode",
      "ServiceTier::" + "Fast",
      "SPEED_TIER_" + "FAST",
      "\\/fast"
    ].join("|")),
    excludePathPattern: /\/(Cargo\.lock|deny\.toml)\b/,
    message:
      "Agent Core must not reintroduce Codex/OpenAI Fast Mode; use explicit provider configuration instead."
  },
  {
    scopePrefix: "crates/lyra-agent-core/",
    pattern: new RegExp([
      "\\bPersonality\\b",
      "personality_" + "spec",
      "supports" + "Personality",
      "supports_" + "personality",
      "model_" + "messages",
      "features\\." + "personality",
      "\\bpersonality\\s*:"
    ].join("|")),
    excludePathPattern: /\/(Cargo\.lock|deny\.toml|schema\/json|schema\/typescript)\b/,
    message:
      "Agent Core must not reintroduce dynamic personality switching; Lyra uses a fixed pragmatic base prompt."
  },
  {
    scopePrefix: "crates/lyra-agent-core/",
    pattern: new RegExp("gpt-5\\.[0-9][A-Za-z0-9._-]*co" + "dex"),
    excludePathPattern: /\/(Cargo\.lock|deny\.toml)\b/,
    message:
      "Agent Core examples and tests must use current Lyra model slugs, not old model examples."
  },
  {
    scopePrefix: "crates/lyra-agent-core/",
    pattern: new RegExp([
      "Context" + "Compaction",
      "context" + "Compaction",
      "Context" + "Compacted",
      "RolloutItem::" + "Compacted",
      "ResponseItem::" + "Compaction",
      "Compacted" + "Item",
      "SubAgentSource::" + "Compact",
      "SubAgent" + "Compact",
      "auto-" + "compact",
      "responses/" + "compact",
      "compact_" + "prompt",
      "model_auto_" + "compact_token_limit",
      "auto_" + "compact_token_limit",
      "experimental_" + "compact_" + "prompt"
    ].join("|")),
    excludePathPattern: /\/(Cargo\.lock|deny\.toml)\b/,
    message:
      "Agent Core must not reintroduce legacy model-guided context compaction APIs, schema, config, or rollout items."
  },
  {
    scopePrefix: "crates/lyra-agent-core/",
    pattern: new RegExp([
      "co" + "dex-rollout-trace",
      "co" + "dex_rollout_trace",
      "CO" + "DEX_ROLLOUT_TRACE_ROOT",
      "Compaction" + "TraceContext",
      "Compaction" + "RequestStarted",
      "Compaction" + "Installed",
      "RawPayloadKind::" + "Compaction"
    ].join("|")),
    excludePathPattern: /\/(Cargo\.lock|deny\.toml)\b/,
    message:
      "Agent rollout tracing must use Lyra-owned names and must not reintroduce old compaction trace paths."
  },
  {
    scopePrefix: "apps/desktop/src/",
    pattern: new RegExp([
      "aiContext" + "Collapse",
      "enableModelGuided" + "Compaction",
      "Context " + "Collapse"
    ].join("|")),
    message:
      "Desktop settings must not expose the removed model-guided context compaction UI."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/",
    pattern: new RegExp([
      "[\"'`]\\/status\\b",
      "[\"'`]\\/clear\\b",
      "[\"'`]\\/fast\\b",
      "[\"'`]\\/experimental\\b",
      "[\"'`]\\/memories\\b",
      "[\"'`]\\/approvals\\b",
      "[\"'`]\\/permissions\\b",
      "[\"'`]\\/personality\\b",
      "[\"'`]\\/compact\\b",
      "[\"'`]\\/debug-m-",
      "[\"'`]\\/rollout\\b",
      "[\"'`]\\/test-approval\\b",
      "[\"'`]\\/debug-config\\b",
      "[\"'`]\\/title\\b",
      "[\"'`]\\/statusline\\b",
      "[\"'`]\\/theme\\b",
      "[\"'`]\\/quit\\b",
      "[\"'`]\\/exit\\b",
      "[\"'`]\\/logout\\b",
      "[\"'`]\\/feedback\\b",
      "[\"'`]\\/apps\\b",
      "[\"'`]\\/plugins\\b",
      "[\"'`]\\/collab\\b",
      "[\"'`]\\/agent\\b",
      "[\"'`]\\/side\\b",
      "[\"'`]\\/subagents\\b",
      "[\"'`]\\/realtime\\b",
      "[\"'`]\\/settings\\b",
      "[\"'`]\\/mention\\b"
    ].join("|")),
    excludePathPattern: /\/tests\//,
    message:
      "AI panel must not expose unsupported Codex-style slash commands. Use explicit Lyra UI actions instead."
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

if (fs.existsSync(path.join(ROOT, "vendor", "lyra-core"))) {
  violations.push("Old Agent Core vendor path is forbidden; first-party runtime code must live under crates/lyra-agent-core.");
}

if (fs.existsSync(path.join(ROOT, "vendor", "portable-pty"))) {
  violations.push("Vendored PTY source must live under third-party/rust/portable-pty, not the old vendor PTY path.");
}

if (fs.existsSync(path.join(ROOT, "agent-core", "rust"))) {
  violations.push("Old Agent Core workspace path is forbidden; first-party Agent Core code must live under crates/lyra-agent-core.");
}

if (fs.existsSync(path.join(ROOT, "agent-core", "rust", "vendor", "bubblewrap"))) {
  violations.push("Bubblewrap source must live under third-party/native/bubblewrap, not inside Agent Core vendor paths.");
}

if (fs.existsSync(path.join(ROOT, "crates", "lyra-agent-core", "realtime-webrtc"))) {
  violations.push("Realtime/voice runtime crate is removed; do not reintroduce crates/lyra-agent-core/realtime-webrtc.");
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
