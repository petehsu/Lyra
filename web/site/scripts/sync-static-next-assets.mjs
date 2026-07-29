import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const legalRoutes = [
  "/legal",
  "/legal/terms",
  "/legal/privacy",
  "/legal/licenses",
  "/legal/providers",
  "/legal/history"
];
const htmlRoutes = [
  { route: "", lang: "en" },
  { route: "/zh", lang: "zh-CN" },
  { route: "/en", lang: "en" },
  ...legalRoutes.flatMap((route) => [
    { route, lang: "en-US" },
    { route: `${route}/en-US`, lang: "en-US" },
    { route: `${route}/zh-CN`, lang: "zh-CN" }
  ])
];
const assets = [
  ...htmlRoutes.map(({ route, lang }) => ({
    sourcePath: `.next/server/app${route || "/index"}.html`,
    targetPath: `.open-next/assets${route || "/index"}.html`,
    lang
  })),
  {
    sourcePath: ".next/server/app/robots.txt.body",
    targetPath: ".open-next/assets/robots.txt"
  },
  {
    sourcePath: ".next/server/app/sitemap.xml.body",
    targetPath: ".open-next/assets/sitemap.xml"
  }
];

const withHtmlLang = (content, route, lang) => {
  const text = content.toString("utf8");
  const htmlTags = text.match(/<html\b[^>]*>/gu) ?? [];
  if (htmlTags.length !== 1) {
    throw new Error(`Expected exactly one <html> tag for ${route || "/"}`);
  }
  const langAttributes = htmlTags[0].match(/\blang="[^"]*"/gu) ?? [];
  if (langAttributes.length !== 1) {
    throw new Error(`Expected exactly one html lang attribute for ${route || "/"}`);
  }
  const nextTag = htmlTags[0].replace(langAttributes[0], `lang="${lang}"`);
  return Buffer.from(text.replace(htmlTags[0], nextTag));
};

for (const { sourcePath, targetPath, lang } of assets) {
  const source = resolve(siteRoot, sourcePath);
  const target = resolve(siteRoot, targetPath);
  if (!existsSync(source)) {
    throw new Error(`Missing prerendered asset: ${sourcePath}`);
  }
  const route = targetPath
    .replace(/^\.open-next\/assets/u, "")
    .replace(/\/index\.html$/u, "")
    .replace(/\.html$/u, "");
  const sourceContent = readFileSync(source);
  const content = lang === undefined
    ? sourceContent
    : withHtmlLang(sourceContent, route, lang);
  if (checkOnly) {
    if (!existsSync(target) || !content.equals(readFileSync(target))) {
      throw new Error(`Static Cloudflare asset is stale: ${targetPath}`);
    }
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

console.log(
  `[site] ${checkOnly ? "verified" : "synced"} ${assets.length} prerendered Cloudflare assets`
);
