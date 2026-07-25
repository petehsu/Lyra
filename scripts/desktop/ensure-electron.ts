import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const requireFromDesktop = createRequire(path.join(desktopRoot, "package.json"));

const LYRA_BUNDLE_ID = "dev.lyra.desktop";
const LYRA_DISPLAY_NAME = "Lyra";
const MAC_LOCATION_USAGE_DESCRIPTION =
  "Lyra uses your physical location to show a readable place name and provide location context to the Agent. Coordinates may be used when a place name cannot be resolved.";

const resolveElectronPackageRoot = (): string => {
  const packageJsonPath = requireFromDesktop.resolve("electron/package.json");
  return path.dirname(packageJsonPath);
};

const resolveElectronBinary = (distOverridePath: string | null): string | null => {
  try {
    const pathFile = path.join(resolveElectronPackageRoot(), "path.txt");
    const relativePath = fs.existsSync(pathFile)
      ? fs.readFileSync(pathFile, "utf-8").trim()
      : "";
    if (relativePath.length === 0) {
      return null;
    }
    const binaryPath = distOverridePath === null
      ? path.join(resolveElectronPackageRoot(), "dist", relativePath)
      : path.join(distOverridePath, relativePath);
    return fs.existsSync(binaryPath) ? binaryPath : null;
  } catch {
    return null;
  }
};

const runElectronInstall = async (electronRoot: string): Promise<number | null> =>
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["install.js"], {
      cwd: electronRoot,
      stdio: "inherit",
      env: process.env
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });

const setPlistString = async (
  plistPath: string,
  key: string,
  value: string
): Promise<void> => {
  try {
    await execFileAsync("plutil", ["-replace", key, "-string", value, plistPath]);
  } catch {
    await execFileAsync("plutil", ["-insert", key, "-string", value, plistPath]);
  }
};

const patchMacLocationPlist = async (plistPath: string): Promise<void> => {
  await setPlistString(plistPath, "NSLocationWhenInUseUsageDescription", MAC_LOCATION_USAGE_DESCRIPTION);
};

const resolveDevElectronDistDir = (): string => path.join(desktopRoot, ".dev-electron");

const ensureLyraDevElectronBundle = async (electronRoot: string): Promise<string | null> => {
  if (process.platform !== "darwin") {
    return null;
  }

  const sourceApp = path.join(electronRoot, "dist", "Electron.app");
  if (fs.existsSync(sourceApp) === false) {
    return null;
  }

  const distDir = resolveDevElectronDistDir();
  const devApp = path.join(distDir, "Electron.app");
  const versionMarker = path.join(distDir, "electron-version.txt");
  const packageJson = JSON.parse(
    await readFile(path.join(electronRoot, "package.json"), "utf-8")
  ) as { readonly version?: string };
  const electronVersion = packageJson.version ?? "unknown";
  const existingVersion = fs.existsSync(versionMarker)
    ? (await readFile(versionMarker, "utf-8")).trim()
    : "";

  if (existingVersion !== electronVersion || fs.existsSync(devApp) === false) {
    await rm(distDir, { recursive: true, force: true });
    await mkdir(distDir, { recursive: true });
    await execFileAsync("cp", ["-R", sourceApp, distDir]);
    await writeFile(versionMarker, `${electronVersion}\n`, "utf-8");
    console.info(`[lyra-electron] Prepared Lyra dev bundle from Electron ${electronVersion}`);
  }

  const plistPath = path.join(devApp, "Contents", "Info.plist");
  await patchMacLocationPlist(plistPath);
  await setPlistString(plistPath, "CFBundleDisplayName", LYRA_DISPLAY_NAME);
  await setPlistString(plistPath, "CFBundleName", LYRA_DISPLAY_NAME);
  await setPlistString(plistPath, "CFBundleIdentifier", LYRA_BUNDLE_ID);

  try {
    await execFileAsync("codesign", ["--force", "--deep", "--sign", "-", devApp]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[lyra-electron] Dev bundle ad-hoc codesign failed: ${message}`);
  }

  return distDir;
};

const main = async (): Promise<void> => {
  const electronRoot = resolveElectronPackageRoot();
  let devDistOverride: string | null = null;

  const stockBinary = resolveElectronBinary(null);
  if (stockBinary === null) {
    console.warn("[lyra-electron] Electron binary is missing; repairing local install.");
    await rm(path.join(electronRoot, "dist"), { recursive: true, force: true });
    await unlink(path.join(electronRoot, "path.txt")).catch(() => undefined);

    const code = await runElectronInstall(electronRoot);
    if (resolveElectronBinary(null) === null) {
      throw new Error(`Electron install failed (${code ?? "signal"}) and no Electron binary was found`);
    }
    console.info("[lyra-electron] Electron install repaired");
  }

  const stockPlist = path.join(electronRoot, "dist", "Electron.app", "Contents", "Info.plist");
  if (fs.existsSync(stockPlist)) {
    await patchMacLocationPlist(stockPlist);
  }

  devDistOverride = await ensureLyraDevElectronBundle(electronRoot);
  const binary = resolveElectronBinary(devDistOverride);
  if (binary === null) {
    throw new Error("Electron binary is unavailable after ensure step");
  }

  if (devDistOverride !== null) {
    console.info(
      `[lyra-electron] Lyra dev bundle ready: ${binary} (bundle id ${LYRA_BUNDLE_ID})`
    );
    console.info(
      `[lyra-electron] Location Services should list "${LYRA_DISPLAY_NAME}" after the first locate attempt`
    );
    return;
  }

  console.info(`[lyra-electron] Electron ready: ${binary}`);
};

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[lyra-electron] ${message}`);
  process.exitCode = 1;
});
