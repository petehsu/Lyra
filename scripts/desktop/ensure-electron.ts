import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { rm, unlink } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const requireFromDesktop = createRequire(path.join(desktopRoot, "package.json"));

const resolveElectronPackageRoot = (): string => {
  const packageJsonPath = requireFromDesktop.resolve("electron/package.json");
  return path.dirname(packageJsonPath);
};

const resolveElectronBinary = (): string | null => {
  try {
    const binaryPath = requireFromDesktop("electron") as unknown;
    return typeof binaryPath === "string" && fs.existsSync(binaryPath) ? binaryPath : null;
  } catch {
    return null;
  }
};

const runElectronInstall = async (electronRoot: string): Promise<number | null> =>
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["install.js"], {
      cwd: electronRoot,
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });

const main = async (): Promise<void> => {
  const existingBinary = resolveElectronBinary();
  if (existingBinary !== null) {
    console.info(`[lyra-electron] Electron ready: ${existingBinary}`);
    return;
  }

  const electronRoot = resolveElectronPackageRoot();
  console.warn("[lyra-electron] Electron binary is missing; repairing local install.");
  await rm(path.join(electronRoot, "dist"), { recursive: true, force: true });
  await unlink(path.join(electronRoot, "path.txt")).catch(() => undefined);

  const code = await runElectronInstall(electronRoot);
  const repairedBinary = resolveElectronBinary();
  if (repairedBinary !== null) {
    console.info(`[lyra-electron] Electron repaired: ${repairedBinary}`);
    return;
  }

  throw new Error(`Electron install failed (${code ?? "signal"}) and no Electron binary was found`);
};

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[lyra-electron] ${message}`);
  process.exitCode = 1;
});
