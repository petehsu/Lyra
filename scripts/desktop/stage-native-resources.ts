import { spawn } from "node:child_process";
import { access, copyFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveCurrentDesktopTarget,
  resolveDesktopTarget,
  type DesktopTarget,
} from "../../apps/desktop/src/main/platform-target";

type CliOptions = {
  readonly target: DesktopTarget;
  readonly profile: "debug" | "release";
  readonly build: boolean;
  readonly clean: boolean;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const desktopRoot = path.join(repoRoot, "apps/desktop");
const stagedNativeRoot = path.join(desktopRoot, "native");
const cargoManifest = path.join(repoRoot, "Cargo.toml");

const runtimePackages = ["lyrad"] as const;
const nativeAddonPackages = [
  "lyra-terminal-core",
  "lyra-lsp-core",
  "lyra-calculator-napi",
  "lyra-files-napi",
  "lyra-image-napi",
  "lyra-resource-napi",
  "lyra-skills-napi",
  "lyra-docs-napi",
  "lyra-download-napi",
  "lyra-mcp-core",
] as const;

const artifactStems = [
  "lyra_terminal_core",
  "lyra_lsp_core",
  "lyra_calculator_napi",
  "lyra_files_napi",
  "lyra_image_napi",
  "lyra_resource_napi",
  "lyra_skills_napi",
  "lyra_docs_napi",
  "lyra_download_napi",
  "lyra_mcp_core",
] as const;

const printUsage = (): void => {
  console.info([
    "Usage: tsx scripts/desktop/stage-native-resources.ts [options]",
    "",
    "Options:",
    "  --target=<platform-arch>  Target id such as darwin-arm64, win32-x64, linux-arm64",
    "  --release                 Build and stage release artifacts",
    "  --stage-only              Do not run cargo build, only copy existing artifacts",
    "  --clean                   Remove the staged target directory before copying",
  ].join("\n"));
};

const parseTarget = (value: string): DesktopTarget => {
  const [platform, arch] = value.split("-");
  if (platform === undefined || arch === undefined || platform.length === 0 || arch.length === 0) {
    throw new Error(`invalid target id: ${value}`);
  }
  return resolveDesktopTarget({
    platform: platform as NodeJS.Platform,
    arch: arch as NodeJS.Architecture,
  });
};

const parseArgs = (): CliOptions => {
  let target = resolveCurrentDesktopTarget();
  let profile: "debug" | "release" = "debug";
  let build = true;
  let clean = false;

  for (const arg of process.argv.slice(2)) {
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--release") {
      profile = "release";
      continue;
    }
    if (arg === "--stage-only") {
      build = false;
      continue;
    }
    if (arg === "--clean") {
      clean = true;
      continue;
    }
    if (arg.startsWith("--target=")) {
      target = parseTarget(arg.slice("--target=".length).trim());
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return { target, profile, build, clean };
};

const run = async (command: string, args: readonly string[]): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed (${code ?? "signal"})`));
    });
  });
};

const cargoBuildArgs = (
  packages: readonly string[],
  options: CliOptions
): readonly string[] => [
  "build",
  "--manifest-path",
  cargoManifest,
  ...packages.flatMap((packageName) => ["-p", packageName]),
  ...(options.profile === "release" ? ["--release"] : []),
  ...(options.target.rustTargetTriple === null ? [] : ["--target", options.target.rustTargetTriple]),
];

const buildArtifacts = async (options: CliOptions): Promise<void> => {
  if (options.target.rustTargetTriple === null) {
    throw new Error(`no Rust target triple for ${options.target.id}`);
  }
  await run("cargo", cargoBuildArgs(runtimePackages, options));
  await run("cargo", cargoBuildArgs(nativeAddonPackages, options));
};

const artifactDirs = (options: CliOptions): readonly string[] => {
  const dirs = [
    ...(options.target.rustTargetTriple === null
      ? []
      : [path.join(repoRoot, "target", options.target.rustTargetTriple, options.profile)]),
    path.join(repoRoot, "target", options.profile),
  ];
  return Array.from(new Set(dirs));
};

const executableName = (target: DesktopTarget): string =>
  target.platform === "win32" ? "lyrad.exe" : "lyrad";

const libraryNames = (stem: string, target: DesktopTarget): readonly string[] => {
  if (target.platform === "win32") {
    return [`${stem}.dll`, `${stem}.node`];
  }
  if (target.platform === "darwin") {
    return [`lib${stem}.dylib`, `${stem}.node`];
  }
  return [`lib${stem}.so`, `${stem}.node`];
};

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const copyFirstExisting = async (
  fromDirs: readonly string[],
  names: readonly string[],
  toDir: string
): Promise<string> => {
  for (const fromDir of fromDirs) {
    for (const name of names) {
      const source = path.join(fromDir, name);
      if (await exists(source)) {
        await copyFile(source, path.join(toDir, name));
        return name;
      }
    }
  }
  throw new Error(
    `missing native artifact; tried ${fromDirs.flatMap((fromDir) =>
      names.map((name) => path.join(fromDir, name))
    ).join(", ")}`
  );
};

const stageArtifacts = async (options: CliOptions): Promise<void> => {
  const fromDirs = artifactDirs(options);
  const toDir = path.join(stagedNativeRoot, options.target.id);
  if (options.clean) {
    await rm(toDir, { recursive: true, force: true });
  }
  await mkdir(toDir, { recursive: true });
  await copyFirstExisting(fromDirs, [executableName(options.target)], toDir);
  for (const stem of artifactStems) {
    await copyFirstExisting(fromDirs, libraryNames(stem, options.target), toDir);
  }
  const staged = await readdir(toDir);
  console.info(`[lyra-native] staged ${staged.length} artifacts for ${options.target.id} -> ${toDir}`);
};

const main = async (): Promise<void> => {
  const options = parseArgs();
  if (options.build) {
    await buildArtifacts(options);
  }
  await stageArtifacts(options);
};

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[lyra-native] ${message}`);
  process.exitCode = 1;
});
