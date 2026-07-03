import type { ChildProcess } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import { spawnManagedChildProcess, terminateManagedChildProcess } from "../process-lifecycle";
import { toHttpDownloadTransportUrl } from "./transport-url";

const PROGRESS_INTERVAL_MS = 500;

export type CurlDownloadEngineUpdate = {
  readonly receivedBytes: number;
  readonly speedBytesPerSecond: number;
};

export type CurlDownloadEngineOptions = {
  readonly taskId: string;
  readonly url: string;
  readonly savePath: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly maxBytesPerSecond?: number | undefined;
  readonly proxyUrl?: string | undefined;
  readonly onUpdate: (update: CurlDownloadEngineUpdate) => void;
  readonly onComplete: () => void;
  readonly onError: (error: Error) => void;
  readonly onPaused: () => void;
  readonly onCanceled: () => void;
};

const getFileSize = async (filePath: string): Promise<number> => {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
};

const buildCurlArgs = (options: CurlDownloadEngineOptions): readonly string[] => {
  const args = [
    "--fail",
    "--location",
    "--continue-at",
    "-",
    "--output",
    options.savePath,
    "--silent",
    "--show-error"
  ];
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    args.push("--header", `${name}: ${value}`);
  }
  if (options.maxBytesPerSecond !== undefined && options.maxBytesPerSecond > 0) {
    args.push("--limit-rate", String(options.maxBytesPerSecond));
  }
  if (options.proxyUrl !== undefined && options.proxyUrl.length > 0) {
    args.push("--proxy", options.proxyUrl);
  }
  args.push(toHttpDownloadTransportUrl(options.url));
  return args;
};

export class CurlDownloadController {
  private process: ChildProcess | null = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private canceled = false;
  private paused = false;
  private lastBytes = 0;
  private lastProgressAt = Date.now();

  public constructor(private readonly options: CurlDownloadEngineOptions) {}

  public pause(): void {
    if (this.canceled || this.paused) {
      return;
    }
    this.paused = true;
    if (this.process !== null) {
      terminateManagedChildProcess(this.process);
    }
    this.stopProgress();
    this.options.onPaused();
  }

  public cancel(): void {
    if (this.canceled) {
      return;
    }
    this.canceled = true;
    if (this.process !== null) {
      terminateManagedChildProcess(this.process);
    }
    this.stopProgress();
    this.options.onCanceled();
  }

  public async start(): Promise<void> {
    try {
      await mkdir(path.dirname(this.options.savePath), { recursive: true });
      this.lastBytes = await getFileSize(this.options.savePath);
      this.lastProgressAt = Date.now();
      this.startProgress();
      const child = spawnManagedChildProcess("curl", buildCurlArgs(this.options), {
        stdio: ["ignore", "pipe", "pipe"]
      });
      this.process = child;
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.once("error", (error) => {
        this.stopProgress();
        if (this.canceled || this.paused) {
          return;
        }
        this.options.onError(error);
      });
      child.once("close", (code) => {
        this.stopProgress();
        this.process = null;
        if (this.canceled || this.paused) {
          return;
        }
        if (code === 0) {
          this.emitProgress();
          this.options.onComplete();
          return;
        }
        this.options.onError(new Error(stderr.trim() || `curl exited with ${code ?? "unknown"}`));
      });
    } catch (error) {
      this.stopProgress();
      if (this.canceled || this.paused) {
        return;
      }
      this.options.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private startProgress(): void {
    this.stopProgress();
    this.progressTimer = setInterval(() => {
      void this.emitProgress();
    }, PROGRESS_INTERVAL_MS);
  }

  private stopProgress(): void {
    if (this.progressTimer === null) {
      return;
    }
    clearInterval(this.progressTimer);
    this.progressTimer = null;
  }

  private async emitProgress(): Promise<void> {
    const receivedBytes = await getFileSize(this.options.savePath);
    const now = Date.now();
    const elapsedSeconds = Math.max((now - this.lastProgressAt) / 1000, 0.001);
    const speedBytesPerSecond = Math.round((receivedBytes - this.lastBytes) / elapsedSeconds);
    this.lastBytes = receivedBytes;
    this.lastProgressAt = now;
    this.options.onUpdate({
      receivedBytes,
      speedBytesPerSecond: Math.max(0, speedBytesPerSecond)
    });
  }
}

export const isCurlDownloadUrl = (url: string): boolean => {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "ftp:" || protocol === "ftps:" || protocol === "sftp:";
  } catch {
    return false;
  }
};
