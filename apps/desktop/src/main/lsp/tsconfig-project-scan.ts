import fs from "node:fs";
import path from "node:path";

// ponytail: event queue is 128; stay under that so a monorepo scan cannot drop diagnostics.
const MAX_CONFIGS = 96;
const MAX_DIRECTORIES = 1_500;
const MAX_DEPTH = 16;

const SKIP_DIRECTORY_NAMES = new Set([
  "node_modules",
  ".git",
  "target",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "Pods",
  "DerivedData",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".tmp-test",
  ".turbo",
  ".gradle",
  ".idea",
  ".cache",
  ".parcel-cache",
  ".pnpm-store",
  ".yarn",
  "__pycache__",
  ".venv",
  "venv",
  "bazel-bin",
  "bazel-out",
  "bazel-testlogs",
  "archive",
  "references",
  "參考"
]);

export const isTypeScriptConfigFileName = (name: string): boolean => {
  const base = name.toLowerCase();
  return base === "tsconfig.json"
    || base === "jsconfig.json"
    || /^tsconfig\.[^/]+\.json$/u.test(base);
};

export const listTypeScriptConfigPaths = (rootPath: string): readonly string[] => {
  const trimmed = rootPath.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const root = path.resolve(trimmed);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(root);
  } catch {
    return [];
  }
  if (stat.isFile()) {
    return isTypeScriptConfigFileName(path.basename(root)) ? [root] : [];
  }
  if (stat.isDirectory() === false) {
    return [];
  }
  const found: string[] = [];
  const queue: Array<{ readonly directory: string; readonly depth: number }> = [
    { directory: root, depth: 0 }
  ];
  let scanned = 0;
  while (queue.length > 0 && found.length < MAX_CONFIGS && scanned < MAX_DIRECTORIES) {
    const item = queue.shift();
    if (item === undefined) {
      break;
    }
    scanned += 1;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(item.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (found.length >= MAX_CONFIGS) {
        break;
      }
      const entryPath = path.join(item.directory, entry.name);
      if (entry.isDirectory()) {
        if (
          item.depth + 1 > MAX_DEPTH
          || SKIP_DIRECTORY_NAMES.has(entry.name)
          || entry.name.startsWith(".")
        ) {
          continue;
        }
        queue.push({ directory: entryPath, depth: item.depth + 1 });
        continue;
      }
      if (entry.isFile() && isTypeScriptConfigFileName(entry.name)) {
        found.push(entryPath);
      }
    }
  }
  return found;
};
