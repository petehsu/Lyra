import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "../..");
const CRATE_DIR = path.join(ROOT, "crates/lyra-render-wasm");
const OUTPUT_DIR = path.join(ROOT, "web/docs/public/wasm");
const GLUE_DIR = path.join(ROOT, "web/docs/lib/render/wasm");

const run = (command: string, args: readonly string[], cwd: string): void => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with code ${result.status ?? "unknown"}`);
  }
};

const copyArtifacts = (sourceDir: string): void => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(GLUE_DIR, { recursive: true });
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
    fs.copyFileSync(sourcePath, path.join(OUTPUT_DIR, fileName));
    if (fileName.endsWith(".d.ts")) {
      fs.copyFileSync(sourcePath, path.join(GLUE_DIR, fileName));
    }
  }
};

const main = (): void => {
  run("rustup", ["target", "add", "wasm32-unknown-unknown"], ROOT);

  const wasmPack = spawnSync("wasm-pack", ["--version"], { encoding: "utf8" });
  if (wasmPack.status !== 0) {
    throw new Error("wasm-pack is required. Install with: cargo install wasm-pack");
  }

  const pkgDir = path.join(CRATE_DIR, "pkg");
  run(
    "wasm-pack",
    ["build", "--target", "web", "--out-dir", pkgDir, "--release"],
    CRATE_DIR
  );

  copyArtifacts(pkgDir);
  console.log(`lyra-render-wasm staged at ${OUTPUT_DIR}`);
};

main();