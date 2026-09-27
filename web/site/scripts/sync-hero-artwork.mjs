import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import sharp from "sharp";

// Keep the original compressed artwork as the single source. Serving the
// decoded SVG avoids differing .svgz Content-Encoding handling across hosts.
const source = new URL("../../已矢量化_优化.svgz", import.meta.url);
const target = new URL("../public/hero-landscape.svg", import.meta.url);
const artwork = gunzipSync(await readFile(source));
const current = await readFile(target).catch((error) => {
  if (error.code !== "ENOENT") throw error;
  return null;
});

if (current === null || !current.equals(artwork)) {
  await mkdir(new URL("../public/", import.meta.url), { recursive: true });
  await writeFile(target, artwork);
  console.log(`[site] Synchronized hero artwork: ${fileURLToPath(target)}`);
}

// The source has ~58k vector paths. Rasterize once at build time, not at
// every intermediate size of the live workbench reveal. Keep the full long
// composition so the opening and desktop wallpaper can use different crops.
const widths = [1200, 2400, 3652];
const fingerprint = createHash("sha256")
  .update(artwork)
  .update(JSON.stringify({ widths, quality: 90, sharp: sharp.versions }))
  .digest("hex");
const stamp = new URL("../public/hero-landscape.sha256", import.meta.url);
const previousStamp = await readFile(stamp, "utf8").catch(() => "");
const outputs = widths.map(width => new URL(`../public/hero-landscape-${width}.webp`, import.meta.url));
const allPresent = (await Promise.all(outputs.map(output => readFile(output).then(() => true, () => false)))).every(Boolean);
if (previousStamp !== fingerprint || !allPresent) {
  for (const [index, width] of widths.entries()) {
    await sharp(artwork)
      .resize({ width })
      .webp({ quality: 90 })
      .toFile(fileURLToPath(outputs[index]));
  }
  await writeFile(stamp, fingerprint);
  console.log("[site] Generated responsive artwork from the original SVGZ");
}
