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
    args: [mainEntry, "--no-sandbox"],
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      LYRA_E2E: "1"
    },
    timeout: 60_000
  });
  try {
    const page = await electronApp.firstWindow({ timeout: 60_000 });
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
