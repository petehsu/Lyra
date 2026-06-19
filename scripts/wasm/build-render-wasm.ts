import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "../..");
const CRATE_DIR = path.join(ROOT, "crates/lyra-render-wasm");
const OUTPUT_DIRS = [
  path.join(ROOT, "web/docs/public/wasm"),
  path.join(ROOT, "apps/desktop/src/renderer/public/wasm")
];
const GLUE_DIR = path.join(ROOT, "web/docs/lib/render/wasm");
const WASI_SDK_DIR = path.join(ROOT, "third-party/wasi-sdk");

const WASI_SDK_VERSION = "24.0";

const wasiSdkArchiveName = (): string => {
  const platform = os.platform();
  const arch = os.arch();
  if (platform === "darwin") {
    return arch === "arm64"
      ? `wasi-sdk-${WASI_SDK_VERSION}-arm64-macos.tar.gz`
      : `wasi-sdk-${WASI_SDK_VERSION}-x86_64-macos.tar.gz`;
  }
  if (platform === "linux") {
    return arch === "arm64"
      ? `wasi-sdk-${WASI_SDK_VERSION}-arm64-linux.tar.gz`
      : `wasi-sdk-${WASI_SDK_VERSION}-x86_64-linux.tar.gz`;
  }
  throw new Error(`unsupported platform for lyra-render-wasm build: ${platform} ${arch}`);
};

const ensureWasiSdk = (): void => {
  const clangPath = path.join(WASI_SDK_DIR, "bin/clang");
  if (fs.existsSync(clangPath)) {
    return;
  }

  const archiveName = wasiSdkArchiveName();
  const downloadUrl = `https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK_VERSION.split(".")[0]}/${archiveName}`;
  fs.mkdirSync(WASI_SDK_DIR, { recursive: true });

  console.log(`downloading wasi-sdk from ${downloadUrl}`);
  const curl = spawnSync(
    "curl",
    ["-L", downloadUrl],
    {
      cwd: WASI_SDK_DIR,
      stdio: ["ignore", "pipe", "inherit"],
      encoding: "buffer"
    }
  );
  if (curl.status !== 0 || curl.stdout === undefined) {
    throw new Error(`failed to download wasi-sdk (${curl.status ?? "unknown"})`);
  }

  const tar = spawnSync("tar", ["xzf", "-", "--strip-components=1"], {
    cwd: WASI_SDK_DIR,
    input: curl.stdout,
    stdio: ["pipe", "inherit", "inherit"]
  });
  if (tar.status !== 0) {
    throw new Error(`failed to extract wasi-sdk (${tar.status ?? "unknown"})`);
  }

  if (!fs.existsSync(clangPath)) {
    throw new Error(`wasi-sdk install incomplete: missing ${clangPath}`);
  }
};

const wasmCompileEnv = (): NodeJS.ProcessEnv => {
  const sysroot = path.join(WASI_SDK_DIR, "share/wasi-sysroot");
  const clang = path.join(WASI_SDK_DIR, "bin/clang");
  return {
    ...process.env,
    CC_wasm32_unknown_unknown: clang,
    CFLAGS_wasm32_unknown_unknown: `--sysroot=${sysroot}`
  };
};

const run = (
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): void => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with code ${result.status ?? "unknown"}`);
  }
};

const copyArtifacts = (sourceDir: string): void => {
  fs.mkdirSync(GLUE_DIR, { recursive: true });
  for (const outputDir of OUTPUT_DIRS) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  for (const fileName of [
    "lyra_render_wasm.js",
    "lyra_render_wasm_bg.wasm",
    "lyra_render_wasm.d.ts",
    "lyra_render_wasm_bg.wasm.d.ts"
  ]) {
    const sourcePath = path.join(sourceDir, fileName);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`missing wasm artifact: ${sourcePath}`);
    }
    for (const outputDir of OUTPUT_DIRS) {
      fs.copyFileSync(sourcePath, path.join(outputDir, fileName));
    }
    if (fileName.endsWith(".d.ts")) {
      fs.copyFileSync(sourcePath, path.join(GLUE_DIR, fileName));
    }
  }
};

const main = (): void => {
  run("rustup", ["target", "add", "wasm32-unknown-unknown"], ROOT);
  ensureWasiSdk();

  const wasmPack = spawnSync("wasm-pack", ["--version"], { encoding: "utf8" });
  if (wasmPack.status !== 0) {
    throw new Error("wasm-pack is required. Install with: cargo install wasm-pack");
  }

  const pkgDir = path.join(CRATE_DIR, "pkg");
  run(
    "wasm-pack",
    ["build", "--target", "web", "--out-dir", pkgDir, "--release"],
    CRATE_DIR,
    wasmCompileEnv()
  );

  copyArtifacts(pkgDir);
  console.log(`lyra-render-wasm staged at ${OUTPUT_DIRS.join(", ")}`);
};

main();