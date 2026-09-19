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
const STORAGE_BACKED_BRIDGES = "apps/desktop/src/main/storage-backed-bridges.ts";
const DESKTOP_PACKAGE_JSON = "apps/desktop/package.json";
const CARGO_TOML = "Cargo.toml";
const REQUIRED_ARCHITECTURE_DOCS = [
  "docs/architecture/overview.md",
  "docs/architecture/storage.md",
  "docs/contracts/native-core-path.md"
] as const;
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "coverage", "target", ".next", "out"]);
const SOURCE_EXT = new Set([".ts", ".tsx", ".mts", ".cts"]);
const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

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
        message: "Terminal runtime lifecycle belongs in native core, not TypeScript child_process handlers."
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
        message: "LSP runtime lifecycle belongs in native core, not TypeScript child_process handlers."
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
  },
  {
    name: "download-manager",
    dirName: "download-manager",
    crateDir: "crates/lyra-download-core",
    cratePackageName: "lyra-download-core",
    servicePath: "apps/desktop/src/main/download-manager/service.ts",
    loaderPath: "apps/desktop/src/main/runtime-client.ts",
    typesPath: "apps/desktop/src/shared/download-manager.ts",
    indexPath: "apps/desktop/src/main/download-manager/index.ts",
    mainBridgeFactoryName: "createDownloadManagerIpcBridge",
    requiredServiceRules: [
      {
        pattern: /from\s+["']\.\.\/runtime-client["']/,
        message: "Download manager service must import the shared runtime client."
      },
      {
        pattern: /\bruntimeClient\.request\b/,
        message: "Download manager service must issue daemon requests through the shared runtime client."
      }
    ],
    forbiddenServiceRules: [
      {
        pattern: /from\s+["']node:child_process["']/,
        message: "Download process lifecycle belongs in native core, not TypeScript child_process handlers."
      },
      {
        pattern: /\bloadDownloadNativeBindings\b|\bplanNativeDownloadJson\b/,
        message: "Download manager service must not call the legacy NAPI planner directly."
      },
      {
        pattern: /\bactive(Http|Curl|Aria2)Downloads\b|\bqueued(Native|Curl|Aria2)TaskIds\b/,
        message: "Download queues and active engine maps must stay in native core."
      }
    ]
  }
] as const;

const tsOwnedMainModules = new Map<string, string>([
  ["auth", "TypeScript-owned shell module: Supabase OAuth and Electron safeStorage coordination."],
  ["auto-update", "TypeScript-owned shell module: packaged app update checks above electron-updater."],
  [
    "component-update",
    "TypeScript-owned shell module: signed component download, staging, activation policy, and rollback coordination."
  ],
  [
    "components",
    "TypeScript-owned shell module: installed component registry, data-schema transactions, and resource resolution."
  ],
  ["events", "TypeScript-owned utilities: main-process event backpressure helpers."],
  ["identity", "TypeScript-owned shell module: local project identity storage and IPC."],
  ["language-packs", "TypeScript-owned shell module: language-pack discovery, validation, and IPC."],
  ["location", "TypeScript-owned shell module: macOS location consent and Electron permission wiring."],
  [
    "screenshot-preview",
    "TypeScript-owned shell module: screenshot preview window and filesystem watcher coordination."
  ],
  [
    "workbench-browser",
    "TypeScript-owned shell module: embedded browser tab/view orchestration in Electron."
  ],
  [
    "workbench-documents",
    "TypeScript-owned shell module: document detection/fetch/view coordination above native parsers."
  ],
  [
    "workbench-observation",
    "TypeScript-owned shell module: renderer/browser observation aggregation and cache."
  ],
  ["search", "TypeScript-owned shell module: provider composition and lightweight search routing."],
  [
    "shell",
    "TypeScript-owned shell module: packaged Git Bash discovery and Electron startup environment wiring."
  ],
  ["login-manager", "TypeScript-owned shell module: Electron credential/session UX and safeStorage coordination."],
  ["linux-compat", "TypeScript-owned shell module: Electron/Linux startup environment integration."],
  ["persona", "TypeScript-owned shell module: user-consented local persona cache and IPC."],
  ["sensitive-values", "TypeScript-owned shell module: Electron-scoped sensitive value ownership and IPC gating."],
  ["storage", "TypeScript-owned shell module: unified storage root resolution and Electron path wiring."],
  ["shared-process", "TypeScript-owned shell module: lifecycle wiring for shared auxiliary processes."],
  [
    "system-notifications",
    "TypeScript-owned shell module: Electron system notification bridge above the unified notification model."
  ],
  ["uiux-packs", "TypeScript-owned shell module: trusted UIUX pack registry and renderer asset protocol."],
  ["workbench-state", "TypeScript-owned shell module: sync IPC bridge for renderer workbench state files."]
]);

const bridgeOnlyMainModules = new Map<string, string>([
  ["accessibility", "Bridge-only module: native accessibility loader/types consumed by browser services."],
  ["agent", "Bridge-only module: Agent IPC forwards to lyrad and owns no Agent state machine."],
  [
    "documents",
    "Bridge-only module: native document parser loader/types exposed to shell services."
  ],
  [
    "performance",
    "Bridge-only module: performance scheduler IPC forwards to lyrad and owns no native scheduling state."
  ],
  ["runtime", "Bridge-only utilities. Runtime ports must stay thin and native-backed where declared."],
  [
    "runtime-update",
    "TypeScript-owned shell module: Runtime V2 safe-point coordination and health-checked replacement."
  ],
  [
    "third-party-apps",
    "TypeScript-owned shell module: signed third-party manifest lifecycle and sandbox/WASI policy."
  ]
]);

const ignoredMainModuleDirs = new Set<string>(["tests"]);

type StableCorePath = {
  readonly domain: "files" | "image" | "docs" | "accessibility";
  readonly coreCrate: string;
  readonly coreDir: string;
  readonly electronAdapterCrate: string;
  readonly electronAdapterDir: string;
  readonly electronLoaderPath: string;
  readonly napiLibrary: string;
};

const STABLE_CORE_PATHS: readonly StableCorePath[] = [
  {
    domain: "files",
    coreCrate: "lyra-files-core",
    coreDir: "crates/lyra-files-core",
    electronAdapterCrate: "lyra-files-napi",
    electronAdapterDir: "crates/lyra-files-napi",
    electronLoaderPath: "apps/desktop/src/main/files/native-loader.ts",
    napiLibrary: "lyra_files_napi"
  },
  {
    domain: "image",
    coreCrate: "lyra-image-core",
    coreDir: "crates/lyra-image-core",
    electronAdapterCrate: "lyra-image-napi",
    electronAdapterDir: "crates/lyra-image-napi",
    electronLoaderPath: "apps/desktop/src/main/image-viewer/native-loader.ts",
    napiLibrary: "lyra_image_napi"
  },
  {
    domain: "docs",
    coreCrate: "lyra-docs-core",
    coreDir: "crates/lyra-docs-core",
    electronAdapterCrate: "lyra-docs-napi",
    electronAdapterDir: "crates/lyra-docs-napi",
    electronLoaderPath: "apps/desktop/src/main/documents/native-loader.ts",
    napiLibrary: "lyra_docs_napi"
  },
  {
    domain: "accessibility",
    coreCrate: "lyra-computer-use-core",
    coreDir: "crates/lyra-computer-use-core",
    electronAdapterCrate: "lyra-accessibility-napi",
    electronAdapterDir: "crates/lyra-accessibility-napi",
    electronLoaderPath: "apps/desktop/src/main/accessibility/native-loader.ts",
    napiLibrary: "lyra_accessibility_napi"
  }
];

const REQUIRED_STABLE_DOMAINS = ["files", "image", "docs", "accessibility"] as const;
const FORBIDDEN_DAEMON_METHOD_PREFIXES = [
  "files.",
  "image.",
  "docs.",
  "accessibility.",
  "computer.",
  "browser."
] as const;
const FORBIDDEN_OS_SHELL_DAEMON_METHOD_PREFIXES = [
  "window.",
  "notification.",
  "safeStorage.",
  "appUpdate.",
  "location.",
  "login.",
  "auth."
] as const;
const NAPI_DEPENDENCY_PATTERN = /^\s*napi(?:-derive)?\s*=/mu;
const CDYLIB_CRATE_TYPE_PATTERN = /crate-type\s*=\s*\[[^\]]*cdylib/u;
const CONTRACT_PATH = "docs/contracts/native-core-path.md";
const LYRAD_ROUTER_PATH = "crates/lyrad/src/router.rs";

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
      if (TEST_FILE_PATTERN.test(entry.name)) {
        continue;
      }
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
    if (ignoredMainModuleDirs.has(entry.name)) {
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
  const delegatedBridgeText = fs.existsSync(toAbsolutePath(STORAGE_BACKED_BRIDGES))
    ? readText(STORAGE_BACKED_BRIDGES)
    : "";
  if (
    delegatedBridgeText.length > 0
    && mainIndexText.includes("createStorageBackedIpcBridges") === false
  ) {
    violations.push(
      `${MAIN_INDEX} must call createStorageBackedIpcBridges() when ${STORAGE_BACKED_BRIDGES} owns delegated bridge wiring.`
    );
  }
  const bridgeWiringText = `${mainIndexText}\n${delegatedBridgeText}`;

  for (const module of nativeOwnedModules) {
    if (bridgeWiringText.includes(module.mainBridgeFactoryName)) {
      continue;
    }
    violations.push(
      `Main-process wiring must include ${module.mainBridgeFactoryName}() for native-owned module '${module.name}'.`
    );
  }
};

const checkNativeOwnedModules = (): void => {
  for (const module of nativeOwnedModules) {
    ensureFile(module.servicePath, `${module.name} native-owned module must expose a service bridge.`);
    ensureFile(module.loaderPath, `${module.name} native-owned module must expose a native loader.`);
    ensureFile(module.typesPath, `${module.name} native-owned module must expose types.`);
    ensureFile(module.indexPath, `${module.name} native-owned module must expose an index entry.`);
    ensureFile(`${module.crateDir}/src/lib.rs`, `${module.name} native-owned module must have a native crate entry.`);

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

const checkStableCorePaths = (): void => {
  const listedDomains = STABLE_CORE_PATHS.map((entry) => entry.domain);
  for (const domain of REQUIRED_STABLE_DOMAINS) {
    if (listedDomains.includes(domain) === false) {
      violations.push(`STABLE_CORE_PATHS must include the ${domain} core path.`);
    }
  }
  const coreCrates = STABLE_CORE_PATHS.map((entry) => entry.coreCrate);
  if (new Set(coreCrates).size !== coreCrates.length) {
    violations.push("STABLE_CORE_PATHS core crate names must be unique.");
  }
  const adapterCrates = STABLE_CORE_PATHS.map((entry) => entry.electronAdapterCrate);
  if (new Set(adapterCrates).size !== adapterCrates.length) {
    violations.push("STABLE_CORE_PATHS Electron adapter crate names must be unique.");
  }

  const workspaceToml = readText(CARGO_TOML);
  const lyradTomlPath = "crates/lyrad/Cargo.toml";
  ensureFile(lyradTomlPath, "lyrad must exist so the native-core path can forbid NAPI daemon deps.");
  ensureFile(LYRAD_ROUTER_PATH, "lyrad router must exist so files/image/docs/a11y stay off the daemon.");
  ensureFile(CONTRACT_PATH, "Native core path contract is missing.");
  const lyradToml = fs.existsSync(toAbsolutePath(lyradTomlPath)) ? readText(lyradTomlPath) : "";
  const routerText = fs.existsSync(toAbsolutePath(LYRAD_ROUTER_PATH))
    ? readText(LYRAD_ROUTER_PATH)
    : "";
  const contractText = fs.existsSync(toAbsolutePath(CONTRACT_PATH)) ? readText(CONTRACT_PATH) : "";

  if (routerText.length > 0) {
    for (const prefix of FORBIDDEN_DAEMON_METHOD_PREFIXES) {
      if (routerText.includes(`starts_with("${prefix}")`)) {
        violations.push(
          `${LYRAD_ROUTER_PATH} must not route ${prefix}* ; GPUIX links the matching *-core crate instead of adding a lyrad method.`
        );
      }
    }
    for (const prefix of FORBIDDEN_OS_SHELL_DAEMON_METHOD_PREFIXES) {
      if (routerText.includes(`starts_with("${prefix}")`)) {
        violations.push(
          `${LYRAD_ROUTER_PATH} must not route ${prefix}* ; window chrome, notifications, safeStorage, auto-update, location, and login vault stay OS shell adapters.`
        );
      }
    }
  }

  for (const entry of STABLE_CORE_PATHS) {
    const coreTomlPath = `${entry.coreDir}/Cargo.toml`;
    const adapterTomlPath = `${entry.electronAdapterDir}/Cargo.toml`;
    ensureFile(coreTomlPath, `${entry.domain} stable core crate is missing.`);
    ensureFile(`${entry.coreDir}/src/lib.rs`, `${entry.domain} stable core crate must have a library entry.`);
    ensureFile(adapterTomlPath, `${entry.domain} Electron NAPI adapter crate is missing.`);
    ensureFile(entry.electronLoaderPath, `${entry.domain} Electron NAPI loader is missing.`);

    if (workspaceToml.includes(`"${entry.coreDir}"`) === false) {
      violations.push(`${CARGO_TOML} must include ${entry.coreDir} as the stable ${entry.domain} core.`);
    }
    if (workspaceToml.includes(`"${entry.electronAdapterDir}"`) === false) {
      violations.push(
        `${CARGO_TOML} must include ${entry.electronAdapterDir} as the Electron-only ${entry.domain} adapter.`
      );
    }

    if (fs.existsSync(toAbsolutePath(coreTomlPath))) {
      const coreToml = readText(coreTomlPath);
      if (NAPI_DEPENDENCY_PATTERN.test(coreToml)) {
        violations.push(
          `${coreTomlPath} is the stable ${entry.domain} path and must not depend on napi / napi-derive.`
        );
      }
      if (CDYLIB_CRATE_TYPE_PATTERN.test(coreToml)) {
        violations.push(
          `${coreTomlPath} is the stable ${entry.domain} path and must not be a Node cdylib.`
        );
      }
    }

    if (fs.existsSync(toAbsolutePath(adapterTomlPath))) {
      const adapterToml = readText(adapterTomlPath);
      if (adapterToml.includes(entry.coreCrate) === false) {
        violations.push(
          `${adapterTomlPath} must wrap ${entry.coreCrate}; GPUIX links the core, not this adapter.`
        );
      }
      if (NAPI_DEPENDENCY_PATTERN.test(adapterToml) === false) {
        violations.push(
          `${adapterTomlPath} is the Electron NAPI adapter for ${entry.domain} and must keep napi.`
        );
      }
    }

    if (fs.existsSync(toAbsolutePath(entry.electronLoaderPath))) {
      const loaderText = readText(entry.electronLoaderPath);
      if (loaderText.includes(entry.napiLibrary) === false) {
        violations.push(
          `${entry.electronLoaderPath} must load ${entry.napiLibrary} as the Electron adapter, not as the GPUIX path.`
        );
      }
    }

    if (lyradToml.includes(entry.electronAdapterCrate)) {
      violations.push(
        `${lyradTomlPath} must not depend on ${entry.electronAdapterCrate}; GPUIX links ${entry.coreCrate} directly.`
      );
    }

    if (contractText.length > 0) {
      if (contractText.includes(entry.coreCrate) === false) {
        violations.push(`${CONTRACT_PATH} must name ${entry.coreCrate} as the stable ${entry.domain} path.`);
      }
      if (contractText.includes(entry.electronAdapterCrate) === false) {
        violations.push(
          `${CONTRACT_PATH} must name ${entry.electronAdapterCrate} as the Electron-only ${entry.domain} adapter.`
        );
      }
    }
  }
};

checkMainModuleRegistry();
checkCargoWorkspace();
checkDesktopNativeBuildScript();
checkMainBridgeWiring();
checkNativeOwnedModules();
checkStableCorePaths();
checkPurityScopes();
checkRequiredDocs();

if (violations.length > 0) {
  console.error("\n[Lyra Native-Core Guard] Violations found:\n");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}
