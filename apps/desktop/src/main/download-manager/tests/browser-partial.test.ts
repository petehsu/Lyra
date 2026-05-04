import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  materializeBrowserPartialFileForResume,
  resolveBrowserPartialFileName
} from "../browser-partial";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "lyra-download-partial-"));
  tempDirs.push(tempDir);
  return tempDir;
};

afterEach(async () => {
  for (const tempDir of tempDirs.splice(0)) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("browser partial download helpers", () => {
  test("derives final file names from browser partial suffixes", () => {
    expect(resolveBrowserPartialFileName(
      "/downloads/video.mp4.crdownload",
      "fallback.bin"
    )).toBe("video.mp4");
    expect(resolveBrowserPartialFileName(
      "/downloads/archive.zip.part",
      "fallback.bin"
    )).toBe("archive.zip");
    expect(resolveBrowserPartialFileName(
      "/downloads/Unconfirmed 12345.crdownload",
      "real-name.iso"
    )).toBe("real-name.iso");
  });

  test("copies a browser partial file into the resume target without overwriting", async () => {
    const tempDir = await createTempDir();
    const partialPath = path.join(tempDir, "file.zip.crdownload");
    const savePath = path.join(tempDir, "nested", "file.zip");
    await writeFile(partialPath, "partial");

    materializeBrowserPartialFileForResume(partialPath, savePath);
    expect(await readFile(savePath, "utf8")).toBe("partial");

    await writeFile(savePath, "existing");
    materializeBrowserPartialFileForResume(partialPath, savePath);
    expect(await readFile(savePath, "utf8")).toBe("existing");
  });

  test("allows the partial file to already be the final target", async () => {
    const tempDir = await createTempDir();
    const savePath = path.join(tempDir, "file.zip");
    await mkdir(path.dirname(savePath), { recursive: true });
    await writeFile(savePath, "partial");

    materializeBrowserPartialFileForResume(savePath, savePath);
    expect(await readFile(savePath, "utf8")).toBe("partial");
  });
});
