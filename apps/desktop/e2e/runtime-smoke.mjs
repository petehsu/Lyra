import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainEntry = path.join(appRoot, "out", "main", "index.cjs");
const tempRoot = process.platform === "win32" ? tmpdir() : "/tmp";
const tempHome = await mkdtemp(path.join(tempRoot, "lyra-e2e-home-"));

const fail = (message) => {
  throw new Error(`[lyra-e2e] ${message}`);
};

try {
  await stat(mainEntry).catch(() => fail(`missing built main entry: ${mainEntry}`));
  const electronApp = await electron.launch({
    args: ["--no-sandbox", mainEntry],
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      LYRA_E2E: "1",
      ELECTRON_ENABLE_LOGGING: "1"
    },
    timeout: 60_000
  });
  const electronOutput = [];
  const electronProcess = electronApp.process();
  electronProcess.stdout?.on("data", (chunk) => {
    electronOutput.push(`[stdout] ${String(chunk)}`);
  });
  electronProcess.stderr?.on("data", (chunk) => {
    electronOutput.push(`[stderr] ${String(chunk)}`);
  });
  try {
    const page = await electronApp.firstWindow({ timeout: 60_000 }).catch((error) => {
      const exit = electronProcess.exitCode === null
        ? "still running"
        : `exit code ${electronProcess.exitCode}`;
      const output = electronOutput.join("").trim();
      throw new Error(
        `[lyra-e2e] Electron closed before creating its first window (${exit}).\n`
        + `${error instanceof Error ? error.stack ?? error.message : String(error)}`
        + (output.length > 0 ? `\nElectron output:\n${output}` : "\nElectron produced no output.")
      );
    });
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
    await page.waitForFunction(
      () => typeof window.lyraDesktop === "object" && window.lyraDesktop !== null,
      undefined,
      { timeout: 30_000 }
    );

    const bridgeSnapshot = await page.evaluate(() => ({
      hasAgent: typeof window.lyraDesktop?.agent?.createSession === "function",
      hasFiles: typeof window.lyraDesktop?.files?.readHome === "function",
      productName: window.lyraDesktop?.appMeta?.productName ?? null
    }));
    if (bridgeSnapshot.hasAgent !== true || bridgeSnapshot.hasFiles !== true) {
      fail(`preload bridge incomplete: ${JSON.stringify(bridgeSnapshot)}`);
    }

    await page.evaluate(async () => {
      await window.lyraDesktop.workbenchState.write(
        "preferences",
        JSON.stringify({ locale: "en-US" })
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => document.documentElement.lang === "en-US",
      undefined,
      { timeout: 30_000 }
    );
    await page.getByPlaceholder("Search, enter a URL, or enter a file path").waitFor({
      state: "visible",
      timeout: 30_000
    });
    const postponeLocationPermission = page.getByRole("button", { name: "Not now" });
    if (await postponeLocationPermission.isVisible()) {
      await postponeLocationPermission.click();
    }
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByRole("combobox", { name: "Language" }).click();
    await page.getByRole("option", { name: "Simplified Chinese" }).click();
    await page.waitForFunction(
      () => document.documentElement.lang === "zh-CN",
      undefined,
      { timeout: 30_000 }
    );
    await page.getByPlaceholder("搜索、输入网址或文件路径").waitFor({
      state: "visible",
      timeout: 30_000
    });

    const blockedFileUrl = await page.evaluate(() =>
      window.lyraDesktop.openExternal("file:///tmp/lyra-e2e-secret")
    );
    if (blockedFileUrl !== false) {
      fail("openExternal accepted file:// URL");
    }

    const session = await page.evaluate(async () => {
      const created = await window.lyraDesktop.agent.createSession({
        title: "Lyra E2E Runtime Smoke"
      });
      const read = await window.lyraDesktop.agent.readSession({ sessionId: created.id });
      return {
        createdId: created.id,
        readId: read.id,
        title: read.title
      };
    });
    if (session.createdId !== session.readId || session.title !== "Lyra E2E Runtime Smoke") {
      fail(`agent IPC/session smoke failed: ${JSON.stringify(session)}`);
    }
  } finally {
    await electronApp.close().catch(() => undefined);
  }
} finally {
  await rm(tempHome, { recursive: true, force: true });
}
