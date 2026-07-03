import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { copyFile, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const corruptPathFor = (filePath: string): string => `${filePath}.corrupt`;
const tempPathFor = (filePath: string): string =>
  `${filePath}.tmp-${process.pid}-${randomUUID()}`;

const syncParentDirectorySync = (filePath: string): void => {
  let fd: number | null = null;
  try {
    fd = openSync(path.dirname(filePath), "r");
    fsyncSync(fd);
  } catch {
    // Directory fsync is best-effort on non-POSIX filesystems.
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }
};

const syncParentDirectory = async (filePath: string): Promise<void> => {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path.dirname(filePath), "r");
    await handle.sync();
  } catch {
    // Directory fsync is best-effort on non-POSIX filesystems.
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

export const quarantineCorruptFileSync = (
  filePath: string,
  reason: string,
  logPrefix: string
): void => {
  if (existsSync(filePath) === false) {
    return;
  }
  const corruptPath = corruptPathFor(filePath);
  try {
    rmSync(corruptPath, { force: true });
    renameSync(filePath, corruptPath);
    console.error(`[${logPrefix}] quarantined corrupt JSON ${filePath} -> ${corruptPath}: ${reason}`);
  } catch (error) {
    try {
      copyFileSync(filePath, corruptPath);
      rmSync(filePath, { force: true });
      console.error(`[${logPrefix}] copied corrupt JSON ${filePath} -> ${corruptPath}: ${reason}`);
    } catch (copyError) {
      console.error(
        `[${logPrefix}] failed to quarantine corrupt JSON ${filePath}: ${String(error)}; copy failed: ${String(copyError)}`
      );
    }
  }
};

export const quarantineCorruptFile = async (
  filePath: string,
  reason: string,
  logPrefix: string
): Promise<void> => {
  const corruptPath = corruptPathFor(filePath);
  try {
    await rm(corruptPath, { force: true });
    await rename(filePath, corruptPath);
    console.error(`[${logPrefix}] quarantined corrupt JSON ${filePath} -> ${corruptPath}: ${reason}`);
  } catch (error) {
    try {
      await copyFile(filePath, corruptPath);
      await rm(filePath, { force: true });
      console.error(`[${logPrefix}] copied corrupt JSON ${filePath} -> ${corruptPath}: ${reason}`);
    } catch (copyError) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ENOENT") {
        console.error(
          `[${logPrefix}] failed to quarantine corrupt JSON ${filePath}: ${String(error)}; copy failed: ${String(copyError)}`
        );
      }
    }
  }
};

export const readJsonFileSync = (filePath: string, logPrefix: string): unknown | null => {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      console.error(`[${logPrefix}] failed to read ${filePath}: ${String(error)}`);
    }
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    quarantineCorruptFileSync(filePath, String(error), logPrefix);
    return null;
  }
};

export const readJsonFile = async (filePath: string, logPrefix: string): Promise<unknown | null> => {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      console.error(`[${logPrefix}] failed to read ${filePath}: ${String(error)}`);
    }
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    await quarantineCorruptFile(filePath, String(error), logPrefix);
    return null;
  }
};

export const writeFileAtomicSync = (filePath: string, contents: string): void => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = tempPathFor(filePath);
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx");
    writeFileSync(fd, contents, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tempPath, filePath);
    syncParentDirectorySync(filePath);
  } catch (error) {
    if (fd !== null) {
      closeSync(fd);
    }
    rmSync(tempPath, { force: true });
    throw error;
  }
};

export const writeFileAtomic = async (filePath: string, contents: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = tempPathFor(filePath);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(tempPath, "wx");
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(tempPath, filePath);
    await syncParentDirectory(filePath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
};
