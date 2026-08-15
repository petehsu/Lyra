import { createRequire } from "node:module";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = "/Users/petehsu/Documents/Lyra";
const outputRoot = path.join(repositoryRoot, "Lyra宣传视频");
const sourceSvg = path.join(
  repositoryRoot,
  "apps/desktop/src/renderer/assets/brand/generated/lyra-mark-white.svg"
);
const outputSvg = path.join(outputRoot, "Lyra-Logo-White.svg");
const outputPng = path.join(outputRoot, "Lyra-Logo-White-4096.png");

await copyFile(sourceSvg, outputSvg);

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(repositoryRoot, "apps/desktop/node_modules/playwright"));
const source = await readFile(sourceSvg, "utf8");
const scalableSource = source.replace('width="1024" height="1024"', 'width="100%" height="100%" viewBox="0 0 1024 1024"');
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true
});

try {
  const page = await browser.newPage({
    viewport: { width: 4096, height: 4096 },
    deviceScaleFactor: 1
  });
  await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block}</style>${scalableSource}`);
  await page.screenshot({ path: outputPng, omitBackground: true });
} finally {
  await browser.close();
}

console.log(outputSvg);
console.log(outputPng);
