import { describe, expect, test } from "vitest";

import {
  detectMissingArchiveParts,
  planArchiveExtraction,
  resolveArchiveKind
} from "../post-processing";
import type { DownloadManagerTask } from "../../../shared/download-manager";

const taskFor = (fileName: string): DownloadManagerTask => ({
  id: `download-${fileName}`,
  url: `https://example.com/${fileName}`,
  fileName,
  savePath: `/tmp/${fileName}`,
  directory: "/tmp",
  protocol: "https",
  source: "manual",
  state: "completed",
  receivedBytes: 1,
  totalBytes: 1,
  speedBytesPerSecond: 0,
  priority: "normal",
  connectionsRequested: 1,
  connectionsActive: 0,
  canResume: false,
  createdAt: "2026-05-04T00:00:00.000Z",
  updatedAt: "2026-05-04T00:00:00.000Z",
  tags: []
});

const settings = {
  autoExtract: true,
  deleteArchiveAfterExtract: false,
  detectSplitArchives: true
};

describe("download post processing", () => {
  test("detects missing next split archive segment", () => {
    expect(detectMissingArchiveParts(
      "/tmp/archive.zip.001",
      (candidate) => candidate.endsWith(".001")
    )).toEqual(["/tmp/archive.zip.002"]);
  });

  test("detects missing previous rar part", () => {
    expect(detectMissingArchiveParts(
      "/tmp/movie.part3.rar",
      (candidate) => candidate.endsWith("part3.rar")
    )).toEqual(["/tmp/movie.part2.rar"]);
  });

  test("recognizes common archive families", () => {
    expect(resolveArchiveKind("/tmp/app.zip")).toBe("zip");
    expect(resolveArchiveKind("/tmp/app.tar.gz")).toBe("tar");
    expect(resolveArchiveKind("/tmp/app.tgz")).toBe("tar");
    expect(resolveArchiveKind("/tmp/app.7z")).toBe("sevenZip");
    expect(resolveArchiveKind("/tmp/app.rar")).toBe("rar");
    expect(resolveArchiveKind("/tmp/app.txt")).toBeNull();
  });

  test("plans extraction commands with fallbacks for 7z and rar archives", () => {
    expect(planArchiveExtraction(taskFor("bundle.7z"), settings)?.commands.map((item) => item.command)).toEqual([
      "7z",
      "7zz",
      "unar"
    ]);
    expect(planArchiveExtraction(taskFor("movie.rar"), settings)?.commands.map((item) => item.command)).toEqual([
      "7z",
      "7zz",
      "unar",
      "unrar"
    ]);
  });

  test("uses tar for tar archives and PowerShell for zip extraction on Windows", () => {
    expect(planArchiveExtraction(taskFor("logs.tar.xz"), settings)?.commands[0]).toMatchObject({
      command: "tar",
      args: ["-xf", "/tmp/logs.tar.xz", "-C", "/tmp/logs"]
    });
    expect(planArchiveExtraction(taskFor("app.zip"), settings, "win32")?.commands[0]?.command).toBe("powershell.exe");
  });
});
