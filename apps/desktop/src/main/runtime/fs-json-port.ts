import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type FsJsonPort = {
  readonly ensureDirectory: (directoryPath: string) => Promise<void>;
  readonly readJsonFile: <T>(filePath: string, fallback: T) => Promise<T>;
  readonly writeJsonFile: (filePath: string, payload: unknown) => Promise<void>;
};

// TS orchestrates app flow, while this port keeps heavy IO/parsing replaceable
// by Rust NAPI later without changing callers.
export const createNodeFsJsonPort = (): FsJsonPort => ({
  ensureDirectory: async (directoryPath: string) => {
    await mkdir(directoryPath, { recursive: true });
  },
  readJsonFile: async <T>(filePath: string, fallback: T) => {
    try {
      const contents = await readFile(filePath, "utf8");
      return JSON.parse(contents) as T;
    } catch (_error) {
      return fallback;
    }
  },
  writeJsonFile: async (filePath: string, payload: unknown) => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  }
});
