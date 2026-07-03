import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import type {
  DownloadManagerPostProcessingSettings,
  DownloadManagerTask
} from "../../shared/download-manager";
import { spawnManagedChildProcess } from "../process-lifecycle";

export type DownloadPostProcessingResult = {
  readonly state: "idle" | "completed" | "warning" | "failed";
  readonly message?: string | undefined;
  readonly missingParts?: readonly string[] | undefined;
};

export type DownloadArchiveKind = "zip" | "tar" | "sevenZip" | "rar";

export type DownloadArchiveExtractionCommand = {
  readonly command: string;
  readonly args: readonly string[];
};

const splitArchivePatterns = [
  /^(?<base>.+\.(?:7z|zip|tar|rar))\.(?<index>\d{3})$/iu,
  /^(?<base>.+)\.part(?<index>\d+)\.rar$/iu
];

export const detectMissingArchiveParts = (
  filePath: string,
  exists: (candidatePath: string) => boolean = existsSync
): readonly string[] => {
  const directory = path.dirname(filePath);
  const fileName = path.basename(filePath);
  for (const pattern of splitArchivePatterns) {
    const match = pattern.exec(fileName);
    const indexText = match?.groups?.index;
    const baseName = match?.groups?.base;
    if (match === null || indexText === undefined || baseName === undefined) {
      continue;
    }
    const index = Number.parseInt(indexText, 10);
    if (Number.isFinite(index) === false || index <= 0) {
      return [];
    }
    const missing: string[] = [];
    if (index > 1) {
      const previous = fileName.includes(".part")
        ? path.join(directory, `${baseName}.part${index - 1}.rar`)
        : path.join(directory, `${baseName}.${String(index - 1).padStart(indexText.length, "0")}`);
      if (exists(previous) === false) {
        missing.push(previous);
      }
    }
    if (index === 1) {
      const next = fileName.includes(".part")
        ? path.join(directory, `${baseName}.part2.rar`)
        : path.join(directory, `${baseName}.${String(2).padStart(indexText.length, "0")}`);
      if (exists(next) === false) {
        missing.push(next);
      }
    }
    return missing;
  }
  return [];
};

export const resolveArchiveKind = (filePath: string): DownloadArchiveKind | null => {
  const fileName = path.basename(filePath).toLowerCase();
  if (fileName.endsWith(".zip")) {
    return "zip";
  }
  if (
    fileName.endsWith(".tar")
    || fileName.endsWith(".tgz")
    || fileName.endsWith(".tar.gz")
    || fileName.endsWith(".tar.bz2")
    || fileName.endsWith(".tbz2")
    || fileName.endsWith(".tar.xz")
    || fileName.endsWith(".txz")
  ) {
    return "tar";
  }
  if (fileName.endsWith(".7z")) {
    return "sevenZip";
  }
  if (fileName.endsWith(".rar")) {
    return "rar";
  }
  return null;
};

const archiveBaseName = (fileName: string): string =>
  fileName
    .replace(/\.tar\.(?:gz|bz2|xz)$/iu, "")
    .replace(/\.(?:tgz|tbz2|txz|zip|tar|7z|rar)$/iu, "");

const buildArchiveExtractionCommands = (
  kind: DownloadArchiveKind,
  archivePath: string,
  targetDirectory: string,
  platform: NodeJS.Platform = process.platform
): readonly DownloadArchiveExtractionCommand[] => {
  if (kind === "zip") {
    return platform === "win32"
      ? [{
          command: "powershell.exe",
          args: [
            "-NoProfile",
            "-Command",
            "Expand-Archive",
            "-LiteralPath",
            archivePath,
            "-DestinationPath",
            targetDirectory,
            "-Force"
          ]
        }]
      : [
          {
            command: "unzip",
            args: ["-o", archivePath, "-d", targetDirectory]
          },
          {
            command: "7z",
            args: ["x", "-y", `-o${targetDirectory}`, archivePath]
          },
          {
            command: "7zz",
            args: ["x", "-y", `-o${targetDirectory}`, archivePath]
          },
          {
            command: "unar",
            args: ["-force-overwrite", "-output-directory", targetDirectory, archivePath]
          }
        ];
  }
  if (kind === "tar") {
    return [{
      command: "tar",
      args: ["-xf", archivePath, "-C", targetDirectory]
    }];
  }
  if (kind === "sevenZip") {
    return [
      {
        command: "7z",
        args: ["x", "-y", `-o${targetDirectory}`, archivePath]
      },
      {
        command: "7zz",
        args: ["x", "-y", `-o${targetDirectory}`, archivePath]
      },
      {
        command: "unar",
        args: ["-force-overwrite", "-output-directory", targetDirectory, archivePath]
      }
    ];
  }
  return [
    {
      command: "7z",
      args: ["x", "-y", `-o${targetDirectory}`, archivePath]
    },
    {
      command: "7zz",
      args: ["x", "-y", `-o${targetDirectory}`, archivePath]
    },
    {
      command: "unar",
      args: ["-force-overwrite", "-output-directory", targetDirectory, archivePath]
    },
    {
      command: "unrar",
      args: ["x", "-o+", archivePath, `${targetDirectory}${path.sep}`]
    }
  ];
};

export const planArchiveExtraction = (
  task: DownloadManagerTask,
  settings: DownloadManagerPostProcessingSettings,
  platform: NodeJS.Platform = process.platform
): {
  readonly kind: DownloadArchiveKind;
  readonly targetDirectory: string;
  readonly commands: readonly DownloadArchiveExtractionCommand[];
} | null => {
  const kind = resolveArchiveKind(task.savePath);
  if (kind === null) {
    return null;
  }
  const extractRoot = settings.extractDirectory ?? task.directory;
  const targetDirectory = path.join(extractRoot, archiveBaseName(task.fileName));
  return {
    kind,
    targetDirectory,
    commands: buildArchiveExtractionCommands(kind, task.savePath, targetDirectory, platform)
  };
};

const runCommand = (command: string, args: readonly string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawnManagedChildProcess(command, args, {
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with ${code ?? "unknown"}`));
    });
  });

const runFirstAvailableCommand = async (
  commands: readonly DownloadArchiveExtractionCommand[]
): Promise<void> => {
  const errors: string[] = [];
  for (const candidate of commands) {
    try {
      await runCommand(candidate.command, candidate.args);
      return;
    } catch (error) {
      errors.push(`${candidate.command}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(errors.join("\n") || "No archive extractor succeeded.");
};

const extractArchive = async (
  task: DownloadManagerTask,
  settings: DownloadManagerPostProcessingSettings
): Promise<string> => {
  const plan = planArchiveExtraction(task, settings);
  if (plan === null) {
    throw new Error("Unsupported archive type.");
  }
  await mkdir(plan.targetDirectory, { recursive: true });
  await runFirstAvailableCommand(plan.commands);
  if (settings.deleteArchiveAfterExtract) {
    await rm(task.savePath, { force: true });
  }
  return plan.targetDirectory;
};

export const runDownloadPostProcessing = async (
  task: DownloadManagerTask,
  settings: DownloadManagerPostProcessingSettings
): Promise<DownloadPostProcessingResult> => {
  if (settings.detectSplitArchives) {
    const missingParts = detectMissingArchiveParts(task.savePath);
    if (missingParts.length > 0) {
      return {
        state: "warning",
        message: "Split archive appears incomplete.",
        missingParts
      };
    }
  }
  if (settings.autoExtract === false || resolveArchiveKind(task.savePath) === null) {
    return { state: "idle" };
  }
  try {
    const targetDirectory = await extractArchive(task, settings);
    return {
      state: "completed",
      message: `Extracted to ${targetDirectory}`
    };
  } catch (error) {
    return {
      state: "failed",
      message: error instanceof Error ? error.message : String(error)
    };
  }
};
