import fs from "node:fs";
import path from "node:path";

type PatternRule = {
  readonly pattern: RegExp;
  readonly message: string;
};

type NativeOwnedModule = {
  readonly name: string;
  readonly dirName: string;
  readonly crateDir: string;
  readonly cratePackageName: string;
  readonly servicePath: string;
  readonly loaderPath: string;
  readonly typesPath: string;
  readonly indexPath: string;
  readonly mainBridgeFactoryName: string;
  readonly requiredServiceRules: readonly PatternRule[];
  readonly forbiddenServiceRules: readonly PatternRule[];
};

type SourcePurityScope = {
  readonly root: string;
  readonly label: string;
};

const ROOT = process.cwd();
const MAIN_ROOT = "apps/desktop/src/main";
const MAIN_INDEX = "apps/desktop/src/main/index.ts";
const DESKTOP_PACKAGE_JSON = "apps/desktop/package.json";
const CARGO_TOML = "Cargo.toml";
const REQUIRED_ARCHITECTURE_DOCS = [
  "docs/architecture/rust-first-engineering.md",
  "docs/architecture/lyra-storage-layout.md"
] as const;
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "coverage", "target", ".next", "out"]);
const SOURCE_EXT = new Set([".ts", ".tsx", ".mts", ".cts"]);

const nativeOwnedModules: readonly NativeOwnedModule[] = [
  {
    name: "files",
    dirName: "files",
    crateDir: "crates/lyra-files-napi",
    cratePackageName: "lyra-files-napi",
    servicePath: "apps/desktop/src/main/files/service.ts",
    loaderPath: "apps/desktop/src/main/files/native-loader.ts",
    typesPath: "apps/desktop/src/main/files/types.ts",
    indexPath: "apps/desktop/src/main/files/index.ts",
    mainBridgeFactoryName: "createFilesIpcBridge",
    requiredServiceRules: [
      {
        pattern: /from\s+["']\.\/native-loader["']/,
        message: "Files service must import its native loader."
      },
      {
        pattern: /\bloadFilesNativeBindings\b/,
        message: "Files service must load native bindings explicitly."
      }
    ],
    forbiddenServiceRules: [
      {
        pattern: /from\s+["']node:child_process["']/,
        message: "Files core behavior must not fall back to child_process orchestration in TypeScript."
      },
      {
        pattern: /safeStorage/,
        message: "Files service must not grow a TypeScript secret backend."
      },
      {
        pattern: /Fall through to the existing TypeScript implementation/,
        message: "Files service must not keep TypeScript fallback implementation notes or branches."
      },
      {
        pattern: /\binvokeOrThrow\b/,
        message: "Files service must stay strict-native and must not route through fallback wrappers."
      }
    ]
  },
  {
    name: "terminal",
    dirName: "terminal",
    crateDir: "crates/lyra-terminal-core",
    cratePackageName: "lyra-terminal-core",
    servicePath: "apps/desktop/src/main/terminal/service.ts",
    loaderPath: "apps/desktop/src/main/runtime-client.ts",
    typesPath: "apps/desktop/src/main/terminal/types.ts",
    indexPath: "apps/desktop/src/main/terminal/index.ts",
    mainBridgeFactoryName: "createTerminalIpcBridge",
    requiredServiceRules: [
      {
        pattern: /from\s+["']\.\.\/runtime-client["']/,
        message: "Terminal service must import the shared runtime client."
      },
      {
        pattern: /\bruntimeClient\.request\b/,
        message: "Terminal service must issue daemon requests through the shared runtime client."
      }
    ],
    forbiddenServiceRules: [
      {
        pattern: /from\s+["']node:child_process["']/,
        message: "Terminal runtime lifecycle belongs in Rust, not TypeScript child_process handlers."
      },
      {
        pattern: /safeStorage/,
        message: "Terminal service must not grow TypeScript secret handling."
      },
      {
        pattern: /Fall through to the existing TypeScript implementation/,
        message: "Terminal service must not keep TypeScript fallback implementation notes or branches."
      }
    ]
  },
  {
    name: "lsp",
    dirName: "lsp",
    crateDir: "crates/lyra-lsp-core",
    cratePackageName: "lyra-lsp-core",
    servicePath: "apps/desktop/src/main/lsp/service.ts",
    loaderPath: "apps/desktop/src/main/runtime-client.ts",
    typesPath: "apps/desktop/src/main/lsp/types.ts",
    indexPath: "apps/desktop/src/main/lsp/index.ts",
    mainBridgeFactoryName: "createLspIpcBridge",
    requiredServiceRules: [
      {
        pattern: /from\s+["']\.\.\/runtime-client["']/,
        message: "LSP service must import the shared runtime client."
      },
      {
        pattern: /\bruntimeClient\.request\b/,
        message: "LSP service must issue daemon requests through the shared runtime client."
      }
    ],
    forbiddenServiceRules: [
      {
        pattern: /from\s+["']node:child_process["']/,
        message: "LSP runtime lifecycle belongs in Rust, not TypeScript child_process handlers."
      },
      {
        pattern: /safeStorage/,
        message: "LSP service must not grow TypeScript secret handling."
      },
      {
        pattern: /Fall through to the existing TypeScript implementation/,
        message: "LSP service must not keep TypeScript fallback implementation notes or branches."
      }
    ]
  },
  {
    name: "skills",
    dirName: "skills",
    crateDir: "crates/lyra-skills-napi",
    cratePackageName: "lyra-skills-napi",
    servicePath: "apps/desktop/src/main/skills/service.ts",
    loaderPath: "apps/desktop/src/main/skills/native-loader.ts",
    typesPath: "apps/desktop/src/main/skills/types.ts",
    indexPath: "apps/desktop/src/main/skills/index.ts",
    mainBridgeFactoryName: "createSkillsIpcBridge",
    requiredServiceRules: [
      {
        pattern: /from\s+["']\.\/native-loader["']/,
        message: "Skills service must import its native loader."
      },
      {
        pattern: /\bloadSkillsNativeBindings\b/,
        message: "Skills service must load native bindings explicitly."
      }
    ],
    forbiddenServiceRules: [
      {
        pattern: /from\s+["']node:fs["']|from\s+["']node:fs\/promises["']/,
        message: "Skills package IO belongs in Rust, not in TypeScript service fallbacks."
      },
      {
        pattern: /from\s+["']node:child_process["']/,
        message: "Skills service must not grow TypeScript runtime process management."
      },
      {
        pattern: /safeStorage/,
        message: "Skills service must not grow a TypeScript secret backend."
      },
      {
        pattern: /Fall through to the existing TypeScript implementation/,
        message: "Skills service must not keep TypeScript fallback implementation notes or branches."
      },
      {
        pattern: /\bfallbackCreate\b|\binstallBuiltins\b|\binstallDiscoveredSkills\b|\bpersistInstalled\b|\bfindInstalledSkill\b/,
        message: "Skills service must stay a bridge; install and storage mutation logic belongs in Rust."
      }
    ]
  },
  {
    name: "mcp",
    dirName: "mcp",
    crateDir: "crates/lyra-mcp-core",
    cratePackageName: "lyra-mcp-core",
    servicePath: "apps/desktop/src/main/mcp/service.ts",
    loaderPath: "apps/desktop/src/main/runtime-client.ts",
    typesPath: "apps/desktop/src/main/mcp/types.ts",
    indexPath: "apps/desktop/src/main/mcp/index.ts",
    mainBridgeFactoryName: "createMcpIpcBridge",
    requiredServiceRules: [
      {
        pattern: /from\s+["']\.\.\/runtime-client["']/,
        message: "MCP service must import the shared runtime client."
      },
      {
        pattern: /\bruntimeClient\.request\b/,
        message: "MCP service must issue daemon requests through the shared runtime client."
      }
    ],
    forbiddenServiceRules: [
      {
        pattern: /from\s+["']node:child_process["']/,
        message: "MCP runtime lifecycle belongs in Rust, not in TypeScript child_process handlers."
      },
      {
        pattern: /safeStorage/,
        message: "MCP secret backend must stay native."
      },
      {
        pattern: /Fall through to the existing TypeScript implementation/,
        message: "MCP service must not keep TypeScript fallback implementation notes or branches."
      },
      {
        pattern: /\bruntimeByServerId\b|\bhandleByServerId\b|\bintrospectionByServerId\b|\bstopRuntimeHandle\b|\bstartPersistedServer\b/,
        message: "MCP runtime registry and lifecycle must stay in Rust."
      }
    ]
  },
  {
    name: "resources",
    dirName: "resources",
    crateDir: "crates/lyra-resource-napi",
    cratePackageName: "lyra-resource-napi",
    servicePath: "apps/desktop/src/main/resources/service.ts",
    loaderPath: "apps/desktop/src/main/resources/native-loader.ts",
    typesPath: "apps/desktop/src/main/resources/types.ts",
    indexPath: "apps/desktop/src/main/resources/index.ts",
    mainBridgeFactoryName: "createResourceRuntimeService",
    requiredServiceRules: [
      {
        pattern: /from\s+["']\.\/native-loader["']/,
        message: "Resources service must import its native loader."
      },
      {
        pattern: /\bloadResourcesNativeBindings\b/,
        message: "Resources service must load native bindings explicitly."
      }
    ],
    forbiddenServiceRules: [
      {
        pattern: /from\s+["']node:child_process["']/,
        message: "Resources core behavior must not fall back to child_process orchestration in TypeScript."
      },
      {
        pattern: /safeStorage/,
        message: "Resources service must not grow TypeScript secret handling."
      },
      {
        pattern: /Fall through to the existing TypeScript implementation/,
        message: "Resources service must not keep TypeScript fallback implementation notes or branches."
      }
    ]
  },
  {
    name: "image-viewer",
    dirName: "image-viewer",
    crateDir: "crates/lyra-image-napi",
    cratePackageName: "lyra-image-napi",
    servicePath: "apps/desktop/src/main/image-viewer/service.ts",
    loaderPath: "apps/desktop/src/main/image-viewer/native-loader.ts",
    typesPath: "apps/desktop/src/main/image-viewer/types.ts",
    indexPath: "apps/desktop/src/main/image-viewer/index.ts",
    mainBridgeFactoryName: "createImageViewerIpcBridge",
    requiredServiceRules: [
      {
        pattern: /from\s+["']\.\/native-loader["']/,
        message: "Image viewer service must import its native loader."
      },
      {
        pattern: /\bloadImageViewerNativeBindings\b/,
        message: "Image viewer service must load native bindings explicitly."
      }
    ],
    forbiddenServiceRules: [
      {
        pattern: /from\s+["']node:child_process["']/,
        message: "Image viewer core behavior must not fall back to child_process orchestration in TypeScript."
      },
      {
        pattern: /safeStorage/,
        message: "Image viewer service must not grow TypeScript secret handling."
      },
      {
        pattern: /Fall through to the existing TypeScript implementation/,
        message: "Image viewer service must not keep TypeScript fallback implementation notes or branches."
      },
      {
        pattern: /\bdecode(Image|Tile)\b|\bcanvas\b|\bsharp\b|\bjimp\b/i,
        message: "Image viewer decoding and tile preparation must stay native-owned."
      }
    ]
  }
] as const;

const tsOwnedMainModules = new Map<string, string>([
  [
    "workbench-browser",
    "TypeScript-owned shell module: embedded browser tab/view orchestration in Electron."
  ],
  [
    "workbench-documents",
    "TypeScript-owned shell module: document detection/fetch/view coordination above native parsers."
  ],
  [
    "download-manager",
    "TypeScript-owned shell module: download orchestration with native planning and bundled helper runtimes."
  ],
  [
    "workbench-observation",
    "TypeScript-owned shell module: renderer/browser observation aggregation and cache."
  ],
  ["search", "TypeScript-owned shell module: provider composition and lightweight search routing."],
  ["linux-compat", "TypeScript-owned shell module: Electron/Linux startup environment integration."],
  ["storage", "TypeScript-owned shell module: unified storage root resolution and Electron path wiring."],
  [
    "system-notifications",
    "TypeScript-owned shell module: Electron system notification bridge above the unified notification model."
  ],
  ["uiux-packs", "TypeScript-owned shell module: trusted UIUX pack registry and renderer asset protocol."],
  ["workbench-state", "TypeScript-owned shell module: sync IPC bridge for renderer workbench state files."]
]);

const bridgeOnlyMainModules = new Map<string, string>([
  [
    "documents",
    "Bridge-only module: native document parser loader/types exposed to shell services."
  ],
  ["runtime", "Bridge-only utilities. Runtime ports must stay thin and native-backed where declared."]
]);

const purityScopes: readonly SourcePurityScope[] = [
  {
    root: "apps/desktop/src/shared",
    label: "Shared contracts"
  },
  {
    root: "apps/desktop/src/modules/workbench",
    label: "Renderer workbench source"
  }
];

const purityForbiddenRules: readonly PatternRule[] = [
  {
    pattern: /from\s+["']electron["']|require\(["']electron["']\)/,
    message: "must not import Electron runtime directly"
  },
  {
    pattern: /from\s+["']node:[^"']+["']|require\(["']node:[^"']+["']\)/,
    message: "must not import Node builtins directly"
  }
];

const violations: string[] = [];

const toAbsolutePath = (relativePath: string): string => path.join(ROOT, relativePath);

const toRelativePath = (absolutePath: string): string =>
  path.relative(ROOT, absolutePath).split(path.sep).join("/");

const readText = (relativePath: string): string =>
  fs.readFileSync(toAbsolutePath(relativePath), "utf8");

const ensureFile = (relativePath: string, message: string): void => {
  if (fs.existsSync(toAbsolutePath(relativePath))) {
    return;
  }
  violations.push(`${relativePath} ${message}`);
};

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
    if (SOURCE_EXT.has(path.extname(entry.name))) {
      output.push(toRelativePath(absoluteEntry));
    }
  }
  return output;
};

const checkMainModuleRegistry = (): void => {
  const absoluteMainRoot = toAbsolutePath(MAIN_ROOT);
  const entries = fs.readdirSync(absoluteMainRoot, { withFileTypes: true });
  const classified = new Set<string>([
    ...nativeOwnedModules.map((module) => module.dirName),
    ...tsOwnedMainModules.keys(),
    ...bridgeOnlyMainModules.keys()
  ]);

  for (const entry of entries) {
    if (entry.isDirectory() === false) {
      continue;
    }
    if (classified.has(entry.name)) {
      continue;
    }
    violations.push(
      `${MAIN_ROOT}/${entry.name} is unclassified. Register every desktop main module as native-owned, TypeScript-owned, or bridge-only.`
    );
  }
};

const checkCargoWorkspace = (): void => {
  const cargoToml = readText(CARGO_TOML);
  for (const module of nativeOwnedModules) {
    if (cargoToml.includes(`"${module.crateDir}"`) === false) {
      violations.push(`${CARGO_TOML} must include ${module.crateDir} in the workspace members list.`);
    }
  }
};

const checkDesktopNativeBuildScript = (): void => {
  if (fs.existsSync(toAbsolutePath(DESKTOP_PACKAGE_JSON)) === false) {
    violations.push(`${DESKTOP_PACKAGE_JSON} is missing.`);
    return;
  }

  let packageJson: unknown;
  try {
    packageJson = JSON.parse(readText(DESKTOP_PACKAGE_JSON));
  } catch (error) {
    violations.push(
      `${DESKTOP_PACKAGE_JSON} must be valid JSON (${error instanceof Error ? error.message : String(error)}).`
    );
    return;
  }

  if (typeof packageJson !== "object" || packageJson === null) {
    violations.push(`${DESKTOP_PACKAGE_JSON} must decode to an object.`);
    return;
  }

  const scripts = (packageJson as { readonly scripts?: unknown }).scripts;
  if (typeof scripts !== "object" || scripts === null) {
    violations.push(`${DESKTOP_PACKAGE_JSON} must include scripts.native:build.`);
    return;
  }

  const nativeBuildScript = (scripts as { readonly "native:build"?: unknown })["native:build"];
  if (typeof nativeBuildScript !== "string" || nativeBuildScript.trim().length === 0) {
    violations.push(`${DESKTOP_PACKAGE_JSON} scripts.native:build must be a non-empty string.`);
    return;
  }

  for (const module of nativeOwnedModules) {
    const requiredFlag = `-p ${module.cratePackageName}`;
    if (nativeBuildScript.includes(requiredFlag)) {
      continue;
    }
    violations.push(
      `${DESKTOP_PACKAGE_JSON} scripts.native:build must include '${requiredFlag}' for native-owned module '${module.name}'.`
    );
  }

  const cargoBuildSegments = nativeBuildScript
    .split(/\s*(?:&&|\|\||;)\s*/)
    .filter((segment) => /\bcargo\s+build\b/.test(segment));
  for (const segment of cargoBuildSegments) {
    const packageNames = [...segment.matchAll(/(?:^|\s)-p\s+([^\s&;|]+)/g)]
      .map((match) => match[1])
      .filter((packageName): packageName is string => packageName !== undefined);
    if (packageNames.includes("lyrad") === false) {
      continue;
    }
    const mixedPackages = packageNames.filter((packageName) => packageName !== "lyrad");
    if (mixedPackages.length === 0) {
      continue;
    }
    violations.push(
      `${DESKTOP_PACKAGE_JSON} scripts.native:build must build 'lyrad' in its own cargo build invocation; mixed packages ${mixedPackages.map((packageName) => `'${packageName}'`).join(", ")} can enable Node-API features and break daemon linking.`
    );
  }
};

const checkMainBridgeWiring = (): void => {
  if (fs.existsSync(toAbsolutePath(MAIN_INDEX)) === false) {
    violations.push(`${MAIN_INDEX} is missing.`);
    return;
  }
  const mainIndexText = readText(MAIN_INDEX);

  for (const module of nativeOwnedModules) {
    if (mainIndexText.includes(module.mainBridgeFactoryName)) {
      continue;
    }
    violations.push(
      `${MAIN_INDEX} must wire ${module.mainBridgeFactoryName}() for native-owned module '${module.name}'.`
    );
  }
};

const checkNativeOwnedModules = (): void => {
  for (const module of nativeOwnedModules) {
    ensureFile(module.servicePath, `${module.name} native-owned module must expose a service bridge.`);
    ensureFile(module.loaderPath, `${module.name} native-owned module must expose a native loader.`);
    ensureFile(module.typesPath, `${module.name} native-owned module must expose types.`);
    ensureFile(module.indexPath, `${module.name} native-owned module must expose an index entry.`);
    ensureFile(`${module.crateDir}/src/lib.rs`, `${module.name} native-owned module must have a Rust crate entry.`);

    if (fs.existsSync(toAbsolutePath(module.servicePath)) === false) {
      continue;
    }

    const serviceText = readText(module.servicePath);
    for (const rule of module.requiredServiceRules) {
      if (rule.pattern.test(serviceText)) {
        continue;
      }
      violations.push(`${module.servicePath} ${rule.message}`);
    }
    for (const rule of module.forbiddenServiceRules) {
      if (rule.pattern.test(serviceText) === false) {
        continue;
      }
      violations.push(`${module.servicePath} ${rule.message}`);
    }
  }
};

const checkPurityScopes = (): void => {
  for (const scope of purityScopes) {
    const files = walkSourceFiles(scope.root);
    for (const file of files) {
      const content = readText(file);
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        for (const rule of purityForbiddenRules) {
          if (rule.pattern.test(line) === false) {
            continue;
          }
          violations.push(`${file}:${index + 1} ${scope.label} ${rule.message}.`);
        }
      }
    }
  }
};

const checkRequiredDocs = (): void => {
  for (const documentPath of REQUIRED_ARCHITECTURE_DOCS) {
    ensureFile(
      documentPath,
      "Required architecture guardrail document is missing."
    );
  }
};

checkMainModuleRegistry();
checkCargoWorkspace();
checkDesktopNativeBuildScript();
checkMainBridgeWiring();
checkNativeOwnedModules();
checkPurityScopes();
checkRequiredDocs();

if (violations.length > 0) {
  console.error("\n[Lyra Native-Core Guard] Violations found:\n");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}
