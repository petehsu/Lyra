import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../public/workbench-preview/", import.meta.url));
const html = await readFile(path.join(root, "index.html"), "utf8");
const links = [...html.matchAll(/<link\b[^>]*>/g)].map(match => match[0]);
const sheets = links.filter(link => /rel="stylesheet"/.test(link)).map(link => link.match(/href="([^"]+)"/)?.[1]);
const css = (await Promise.all(sheets.filter(Boolean).map(href => {
  if (!href.startsWith("/workbench-preview/")) throw new Error(`Unexpected preview stylesheet: ${href}`);
  return readFile(path.join(root, href.slice("/workbench-preview/".length)), "utf8");
}))).join("\n");
for (const selector of [".opening-sequence-scene", ".opening-sequence-camera", ".opening-sequence-window", ".opening-sequence-canvas"]) {
  if (!css.includes(selector)) throw new Error(`Film layout is not in entry stylesheets: ${selector}`);
}
if (!/\.opening-sequence-scene\s*\{\s*position:\s*fixed/.test(css)) {
  throw new Error("Film stage is missing its fixed-size layout contract");
}
console.log("Workbench film: stage CSS is loaded by the entry HTML, before either renderer mounts.");
