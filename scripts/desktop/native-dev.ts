import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const IGNORE_DIRS = new Set(["target", "node_modules", ".git", "out", "dist", ".next"]);

export const shouldSkipNativeCargo = (
  sourceNewestMs: number,
  stagedNewestMs: number | null
): boolean => stagedNewestMs !== null && sourceNewestMs <= stagedNewestMs;

export const collectNewestMtime = async (roots: readonly string[]): Promise<number> => {
  let newest = 0;
  for (const root of roots) {
    newest = Math.max(newest, await walkNewest(root));
  }
  return newest;
};

const walkNewest = async (root: string): Promise<number> => {
  let newest = 0;
  const visit = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      try {
        const fileStat = await stat(current);
        newest = Math.max(newest, fileStat.mtimeMs);
      } catch {
        return;
      }
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) {
          continue;
        }
        await visit(full);
        continue;
      }
      if (entry.isFile() !== true) {
        continue;
      }
      const fileStat = await stat(full);
      newest = Math.max(newest, fileStat.mtimeMs);
    }
  };
  await visit(root);
  return newest;
};
