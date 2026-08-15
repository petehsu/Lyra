import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const studioRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = path.resolve(studioRoot, "../..");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(repositoryRoot, "apps/desktop/node_modules/playwright"));

const shotId = process.argv.slice(2).find((argument) => argument !== "--") ?? "000-master";
if (/^[a-z0-9][a-z0-9-]*$/u.test(shotId) === false) {
  throw new Error(`Invalid shot id: ${shotId}`);
}

const shotDirectory = path.resolve(studioRoot, "shots", shotId);
if (shotDirectory.startsWith(`${path.resolve(studioRoot, "shots")}${path.sep}`) === false) {
  throw new Error(`Shot is outside the shots directory: ${shotDirectory}`);
}

const config = JSON.parse(await readFile(path.join(shotDirectory, "shot.json"), "utf8"));
const { width, height } = config.viewport;
const fps = Number(config.fps);
const durationSeconds = Number(config.durationSeconds);
if (
  Number.isInteger(width) === false || Number.isInteger(height) === false ||
  width <= 0 || height <= 0 || Number.isFinite(fps) === false || fps <= 0 ||
  Number.isFinite(durationSeconds) === false || durationSeconds <= 0
) {
  throw new Error(`Invalid render configuration in ${shotDirectory}`);
}

const studioUrl = "http://127.0.0.1:5190";
let devServer;
try {
  const response = await fetch(studioUrl);
  if (response.ok === false) {
    throw new Error(`HTTP ${response.status}`);
  }
} catch {
  devServer = spawn("pnpm", ["dev", "--", "--host", "127.0.0.1"], {
    cwd: studioRoot,
    stdio: "inherit"
  });
  const deadline = Date.now() + 60_000;
  let isReady = false;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(studioUrl)).ok) {
        isReady = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (isReady === false) {
    throw new Error(`Lyra UI Studio did not start at ${studioUrl}`);
  }
}

const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const renderDirectory = path.join(studioRoot, "rendered", shotId, timestamp);
const frameDirectory = path.join(renderDirectory, "frames");
await mkdir(frameDirectory, { recursive: true });

let browser;
try {
  browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true
  });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: config.colorScheme === "light" ? "light" : "dark",
    reducedMotion: "no-preference"
  });
  const page = await context.newPage();
  await page.goto(`${studioUrl}/?shot=${encodeURIComponent(shotId)}&capture=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.documentElement.dataset.lyraShotReady === "true");

  const frameCount = Math.ceil(durationSeconds * fps);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const timeMs = frame * 1000 / fps;
    await page.evaluate(async (value) => window.__LYRA_PROMO_STUDIO__?.seek(value), timeMs);
    const filename = `${String(frame + 1).padStart(6, "0")}.png`;
    await page.screenshot({ path: path.join(frameDirectory, filename) });
  }
  await context.close();

  const videoPath = path.join(renderDirectory, `${shotId}.mp4`);
  await new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-framerate", String(fps),
      "-i", path.join(frameDirectory, "%06d.png"),
      "-c:v", "libx264",
      "-preset", "slow",
      "-crf", "12",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      videoPath
    ], { stdio: "inherit" });
    ffmpeg.once("error", reject);
    ffmpeg.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
  });
  console.log(videoPath);
} finally {
  await browser?.close();
  devServer?.kill("SIGTERM");
}
