import fs from "node:fs";
import path from "node:path";

import {
  RUST_ANALYZER_BUNDLE_TARGETS,
  resolveCurrentRustAnalyzerTarget,
  type RustAnalyzerBundleTarget
} from "../../apps/desktop/src/main/lsp/runtime-paths";

type CliOptions = {
  readonly allTargets: boolean;
  readonly resourcesRoot: string;
  readonly desktopRoot: string;
};

type RustAnalyzerManifest = {
  readonly schemaVersion: number;
  readonly source: string;
  readonly releaseTag: string;
  readonly generatedAt: string;
  readonly targets: readonly {
    readonly id: string;
    readonly relativePath: string;
    readonly sha256: string;
    readonly sizeBytes: number;
  }[];
};

const REPO_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_DESKTOP_ROOT = path.resolve(REPO_ROOT, "apps/desktop");
const DEFAULT_RESOURCES_ROOT = path.resolve(DEFAULT_DESKTOP_ROOT, "resources/lsp");

const green = (text: string): string => `\x1b[32m${text}\x1b[0m`;
const yellow = (text: string): string => `\x1b[33m${text}\x1b[0m`;
const red = (text: string): string => `\x1b[31m${text}\x1b[0m`;

const isExecutable = (filePath: string): boolean => {
  try {
    if (process.platform === "win32") {
      return fs.statSync(filePath).isFile();
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch (_error) {
    return false;
  }
};

const parseArgs = (argv: readonly string[]): CliOptions => {
  let allTargets = false;
  let resourcesRoot = DEFAULT_RESOURCES_ROOT;
  let desktopRoot = DEFAULT_DESKTOP_ROOT;

  for (const arg of argv) {
    if (arg === "--all-targets") {
      allTargets = true;
      continue;
    }

    if (arg.startsWith("--resources-root=")) {
      const value = arg.slice("--resources-root=".length).trim();
      if (value.length === 0) {
        throw new Error("--resources-root cannot be empty");
      }
      resourcesRoot = path.resolve(process.cwd(), value);
      continue;
    }

    if (arg.startsWith("--desktop-root=")) {
      const value = arg.slice("--desktop-root=".length).trim();
      if (value.length === 0) {
        throw new Error("--desktop-root cannot be empty");
      }
      desktopRoot = path.resolve(process.cwd(), value);
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.info(
        [
          "Usage: tsx tools/lsp/preflight-lsp.ts [options]",
          "",
          "Options:",
          "  --all-targets            validate every rust-analyzer target artifact",
          "  --resources-root=<path>  override resources root",
          "  --desktop-root=<path>    override desktop project root"
        ].join("\n")
      );
      process.exit(0);
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return {
    allTargets,
    resourcesRoot,
    desktopRoot
  };
};

const checkPackageDependencies = (desktopRoot: string, failures: string[]): void => {
  const packagePath = path.resolve(desktopRoot, "package.json");
  if (!fs.existsSync(packagePath)) {
    failures.push(`missing desktop package.json: ${packagePath}`);
    return;
  }

  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const merged = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {})
  };

  for (const dependency of [
    "typescript",
    "typescript-language-server",
    "pyright"
  ]) {
    if (typeof merged[dependency] !== "string") {
      failures.push(`missing dependency: ${dependency}`);
    }
  }
};

const checkNodeBin = (desktopRoot: string, failures: string[]): void => {
  const isWindows = process.platform === "win32";
  const suffix = isWindows ? ".cmd" : "";
  const candidates = [
    path.resolve(desktopRoot, "node_modules/.bin/typescript-language-server" + suffix),
    path.resolve(desktopRoot, "node_modules/.bin/pyright-langserver" + suffix)
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      failures.push(`missing local language-server binary: ${candidate}`);
    }
  }
};

const readManifest = (
  resourcesRoot: string,
  failures: string[]
): RustAnalyzerManifest | null => {
  const manifestPath = path.resolve(resourcesRoot, "manifest-rust-analyzer.json");
  if (!fs.existsSync(manifestPath)) {
    failures.push(
      `missing manifest: ${manifestPath} (run lsp:bundle:rust-analyzer first)`
    );
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as RustAnalyzerManifest;
  } catch (error) {
    failures.push(`invalid manifest json: ${String(error)}`);
    return null;
  }
};

const checkRustAnalyzerTarget = (
  resourcesRoot: string,
  target: RustAnalyzerBundleTarget,
  failures: string[]
): void => {
  const binaryPath = path.resolve(resourcesRoot, target.id, target.binaryFileName);
  if (!fs.existsSync(binaryPath)) {
    failures.push(`missing rust-analyzer target binary: ${binaryPath}`);
    return;
  }

  if (!isExecutable(binaryPath)) {
    failures.push(`binary is not executable: ${binaryPath}`);
  }
};

const checkRustAnalyzerBundles = (
  resourcesRoot: string,
  allTargets: boolean,
  failures: string[]
): void => {
  const current = resolveCurrentRustAnalyzerTarget(process.platform, process.arch);
  if (current === null) {
    failures.push(
      `current platform/arch unsupported for rust-analyzer: ${process.platform}/${process.arch}`
    );
    return;
  }

  const targets = allTargets ? RUST_ANALYZER_BUNDLE_TARGETS : [current];
  for (const target of targets) {
    checkRustAnalyzerTarget(resourcesRoot, target, failures);
  }
};

const main = (): void => {
  const options = parseArgs(process.argv.slice(2));
  const failures: string[] = [];

  checkPackageDependencies(options.desktopRoot, failures);
  checkNodeBin(options.desktopRoot, failures);
  const manifest = readManifest(options.resourcesRoot, failures);
  checkRustAnalyzerBundles(options.resourcesRoot, options.allTargets, failures);

  if (manifest !== null) {
    console.info(
      `[lyra-lsp] manifest release=${manifest.releaseTag} generatedAt=${manifest.generatedAt}`
    );
  }

  if (failures.length > 0) {
    console.error(red(`[lyra-lsp] preflight failed (${failures.length})`));
    for (const failure of failures) {
      console.error(red(`- ${failure}`));
    }
    process.exitCode = 1;
    return;
  }

  const scopeText = options.allTargets
    ? "all rust-analyzer targets"
    : "current rust-analyzer target";
  console.info(green(`[lyra-lsp] preflight passed (${scopeText})`));
  console.info(yellow("[lyra-lsp] ready for desktop release packaging"));
};

try {
  main();
} catch (error) {
  console.error(red(`[lyra-lsp] preflight crashed: ${String(error)}`));
  process.exitCode = 1;
}
