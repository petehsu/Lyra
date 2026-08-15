import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const studioRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = path.resolve(studioRoot, "../..");
const outputRoot = path.join(studioRoot, "shots", "003-opening-sequence", "assets");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(repositoryRoot, "apps", "desktop", "node_modules", "playwright"));
const siteUrl = "http://127.0.0.1:5180";

await mkdir(outputRoot, { recursive: true });

let siteServer;
try {
  const response = await fetch(siteUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
} catch {
  siteServer = spawn("pnpm", ["dev"], {
    cwd: path.join(repositoryRoot, "web", "site"),
    stdio: "inherit"
  });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(siteUrl)).ok) break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true
});

try {
  const page = await browser.newPage({
    viewport: { width: 1222, height: 596 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce"
  });

  const capture = async (name, hash, selector) => {
    await page.goto(`${siteUrl}/${hash}`, { waitUntil: "networkidle" });
    await page.evaluate(async () => document.fonts.ready);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    if (selector) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    } else {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(900);
    }
    await page.screenshot({
      path: path.join(outputRoot, `site-${name}.png`),
      animations: "disabled"
    });
  };

  await capture("home", "", null);
  await capture("pricing", "#pricing", "#pricing");
  await capture("download", "#download", "#download");
} finally {
  await browser.close();
  siteServer?.kill("SIGTERM");
}
