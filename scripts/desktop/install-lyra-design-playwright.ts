import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const browserRoot = path.join(desktopRoot, "resources", "playwright-browsers");
const playwrightBin = path.join(
  desktopRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "playwright.cmd" : "playwright"
);

const run = async (): Promise<void> => {
  await mkdir(browserRoot, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(playwrightBin, ["install", "chromium"], {
      cwd: desktopRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: browserRoot,
      },
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`playwright install chromium failed (${code ?? "signal"})`));
    });
  });
  console.info(`[lyra-design] Playwright Chromium staged at ${browserRoot}`);
};

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[lyra-design] ${message}`);
  process.exitCode = 1;
});
