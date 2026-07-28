import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.join(docsRoot, "content", "docs");
const publicRoot = path.join(docsRoot, "public");
const failures = [];

const walk = (root) =>
  readdirSync(root).flatMap((entry) => {
    const absolute = path.join(root, entry);
    return statSync(absolute).isDirectory() ? walk(absolute) : [absolute];
  });

const relative = (file) => path.relative(docsRoot, file).replaceAll(path.sep, "/");
const fail = (file, message) => failures.push(`${relative(file)}: ${message}`);
const mdxFiles = walk(contentRoot).filter((file) => file.endsWith(".mdx"));
const english = new Map();
const chinese = new Map();

for (const file of mdxFiles) {
  const key = relative(file).replace(/\.(?:en-US|zh-CN)\.mdx$/u, "");
  if (file.endsWith(".en-US.mdx")) english.set(key, file);
  if (file.endsWith(".zh-CN.mdx")) chinese.set(key, file);
}

for (const key of new Set([...english.keys(), ...chinese.keys()])) {
  if (!english.has(key)) failures.push(`${key}: missing en-US page`);
  if (!chinese.has(key)) failures.push(`${key}: missing zh-CN page`);
}

const sectionIds = (text) =>
  Array.from(text.matchAll(/\{\/\*\s*section:([a-z0-9-]+)\s*\*\/\}/gu), (match) => match[1]);

const forbidden = [
  [/@lyra\/plugin-sdk/gu, "private plugin SDK reference"],
  [/(?:apps\/desktop\/src|(?:^|\\s)crates\/|(?:^|\\s)packages\/)/gmu, "internal source path"],
  [/(?:LYRA_CHANNELS|window\.lyraDesktop)/gu, "internal desktop symbol"],
  [/(?:HarmonyOS|鸿蒙)/gu, "internal-only platform"],
  [/(?:all data stays local|所有数据(?:都|只)在本地|completely offline|完全离线)/giu, "absolute local/offline claim"]
];

const slugFor = (file) => {
  const withoutLocale = relative(file)
    .replace(/^content\/docs\//u, "")
    .replace(/\.(?:en-US|zh-CN)\.mdx$/u, "");
  return withoutLocale.endsWith("/index")
    ? withoutLocale.slice(0, -"/index".length)
    : withoutLocale === "index"
      ? ""
      : withoutLocale;
};

const slugs = new Set(mdxFiles.filter((file) => file.endsWith(".en-US.mdx")).map(slugFor));

const resolveDocLink = (file, href) => {
  const withoutAnchor = href.split("#", 1)[0];
  if (withoutAnchor.length === 0) return true;
  if (withoutAnchor.startsWith("/contracts/") || withoutAnchor.startsWith("/examples/")) {
    return existsSync(path.join(publicRoot, withoutAnchor.slice(1)));
  }
  if (withoutAnchor.startsWith("/") || /^[a-z]+:/iu.test(withoutAnchor)) return true;
  const currentFile = relative(file)
    .replace(/^content\/docs\//u, "")
    .replace(/\.(?:en-US|zh-CN)\.mdx$/u, "");
  const currentDirectory = path.posix.dirname(currentFile) === "."
    ? ""
    : path.posix.dirname(currentFile);
  const resolved = path.posix
    .normalize(path.posix.join(currentDirectory, withoutAnchor))
    .replace(/\.mdx$/u, "")
    .replace(/\/index$/u, "");
  return slugs.has(resolved);
};

for (const [key, englishFile] of english) {
  const chineseFile = chinese.get(key);
  if (chineseFile === undefined) continue;
  const englishText = readFileSync(englishFile, "utf8");
  const chineseText = readFileSync(chineseFile, "utf8");
  for (const [file, text] of [[englishFile, englishText], [chineseFile, chineseText]]) {
    if (!/^> Status: \*\*[^*]+\*\* .*Verified: \*\*2026-07-28\*\*$/mu.test(text)) {
      fail(file, "missing status, applicable version/contract, or verified date banner");
    }
    const ids = sectionIds(text);
    if (ids.length === 0) fail(file, "no canonical section IDs");
    if (new Set(ids).size !== ids.length) fail(file, "duplicate canonical section ID");
    for (const [pattern, message] of forbidden) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) fail(file, message);
    }
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      const href = match[1];
      if (!resolveDocLink(file, href)) fail(file, `broken local link ${href}`);
    }
  }
  const leftIds = sectionIds(englishText);
  const rightIds = sectionIds(chineseText);
  if (JSON.stringify(leftIds) !== JSON.stringify(rightIds)) {
    failures.push(`${key}: en-US and zh-CN section IDs differ`);
  }
}

for (const metaFile of walk(contentRoot).filter((file) => file.endsWith("meta.en-US.json"))) {
  const chineseFile = metaFile.replace(/meta\.en-US\.json$/u, "meta.zh-CN.json");
  if (!existsSync(chineseFile)) {
    fail(metaFile, "missing zh-CN navigation");
    continue;
  }
  const normalizePages = (file) =>
    JSON.parse(readFileSync(file, "utf8")).pages.map((page) =>
      /^---.*---$/u.test(page) ? "---" : page
    );
  if (JSON.stringify(normalizePages(metaFile)) !== JSON.stringify(normalizePages(chineseFile))) {
    fail(metaFile, "en-US and zh-CN navigation entries differ");
  }
}

const nextConfig = readFileSync(path.join(docsRoot, "next.config.mjs"), "utf8");
const expectedLegacyRoutes = [
  "quickstart",
  "architecture",
  "lcp",
  "topbar",
  "workspace-tabs",
  "search-home",
  "file-manager",
  "file-editor",
  "linux-compat"
];
const redirectEntries = Array.from(
  nextConfig.matchAll(
    /\{\s*source:\s*"([^"]+)",\s*destination:\s*"([^"]+)",\s*permanent:\s*true\s*\}/gu
  ),
  (match) => ({ source: match[1], destination: match[2] })
);
const redirectsBySource = new Map();
for (const redirect of redirectEntries) {
  if (redirectsBySource.has(redirect.source)) {
    failures.push(`next.config.mjs: duplicate redirect for ${redirect.source}`);
  }
  redirectsBySource.set(redirect.source, redirect.destination);
}

const pairedFilesForSlug = (slug) => {
  const key = slug.length === 0 ? "content/docs/index" : `content/docs/${slug}`;
  return {
    english: english.get(key),
    chinese: chinese.get(key)
  };
};

for (const legacy of expectedLegacyRoutes) {
  const sourceRoute = `/docs/${legacy}`;
  const destination = redirectsBySource.get(sourceRoute);
  if (destination === undefined) {
    failures.push(`next.config.mjs: missing legacy redirect for ${legacy}`);
    continue;
  }
  const destinationUrl = new URL(destination, "https://lyra.ltd");
  if (
    destinationUrl.origin !== "https://lyra.ltd"
    || (destinationUrl.pathname !== "/docs" && !destinationUrl.pathname.startsWith("/docs/"))
  ) {
    failures.push(`next.config.mjs: ${sourceRoute} has a non-docs destination ${destination}`);
    continue;
  }
  const targetSlug = destinationUrl.pathname
    .replace(/^\/docs\/?/u, "")
    .replace(/\/$/u, "");
  if (!slugs.has(targetSlug)) {
    failures.push(`next.config.mjs: ${sourceRoute} targets missing page ${destinationUrl.pathname}`);
    continue;
  }
  if (destinationUrl.hash.length > 1) {
    const fragment = decodeURIComponent(destinationUrl.hash.slice(1));
    const pair = pairedFilesForSlug(targetSlug);
    const explicitIdPattern = new RegExp(
      `\\bid=["']${fragment.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}["']`,
      "u"
    );
    for (const [locale, file] of [["en-US", pair.english], ["zh-CN", pair.chinese]]) {
      if (
        file === undefined
        || !explicitIdPattern.test(readFileSync(file, "utf8"))
      ) {
        failures.push(
          `next.config.mjs: ${sourceRoute} fragment #${fragment} lacks an explicit ${locale} target`
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `[docs] ${failure}`).join("\n"));
  process.exit(1);
}

console.log(
  `[docs] ${english.size} bilingual page pairs, navigation, links, redirects, section IDs, and public boundaries verified`
);
