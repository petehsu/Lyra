import type { ChildProcess } from "node:child_process";
import http from "node:http";
import net from "node:net";
import type { Dirent } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { spawnManagedChildProcess, terminateManagedChildProcess } from "../process-lifecycle";

const PROGRESS_INTERVAL_MS = 1000;
const RPC_READY_TIMEOUT_MS = 4000;
const RPC_FIELDS = [
  "gid",
  "status",
  "totalLength",
  "completedLength",
  "downloadSpeed",
  "connections",
  "files",
  "errorMessage"
] as const;

export type Aria2DownloadEngineUpdate = {
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly speedBytesPerSecond: number;
  readonly connectionsActive: number;
};

export type Aria2DownloadEngineOptions = {
  readonly taskId: string;
  readonly url: string;
  readonly directory: string;
  readonly binaryPath: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly maxBytesPerSecond?: number | undefined;
  readonly maxUploadBytesPerSecond?: number | undefined;
  readonly proxyUrl?: string | undefined;
  readonly dhtEnabled?: boolean | undefined;
  readonly peerExchangeEnabled?: boolean | undefined;
  readonly localPeerDiscoveryEnabled?: boolean | undefined;
  readonly selectedFileIndexes?: readonly number[] | undefined;
  readonly seedTimeMinutes?: number | undefined;
  readonly trackerUrls?: readonly string[] | undefined;
  readonly onUpdate: (update: Aria2DownloadEngineUpdate) => void;
  readonly onComplete: () => void;
  readonly onError: (error: Error) => void;
  readonly onPaused: () => void;
  readonly onCanceled: () => void;
};

export type Aria2DownloadProcessOptions = Aria2DownloadEngineOptions & {
  readonly rpcPort: number;
  readonly rpcSecret: string;
};

type Aria2RpcDownloadStatus = {
  readonly status?: string | undefined;
  readonly totalLength?: string | undefined;
  readonly completedLength?: string | undefined;
  readonly downloadSpeed?: string | undefined;
  readonly connections?: string | undefined;
  readonly files?: readonly {
    readonly length?: string | undefined;
    readonly completedLength?: string | undefined;
  }[] | undefined;
  readonly errorMessage?: string | undefined;
};

type JsonRpcResponse<T> = {
  readonly result?: T | undefined;
  readonly error?: {
    readonly code?: number | undefined;
    readonly message?: string | undefined;
  } | undefined;
};

const getDirectorySize = async (directory: string): Promise<number> => {
  let total = 0;
  let entries: Dirent<string>[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return 0;
  }
  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(entryPath);
      return;
    }
    try {
      total += (await stat(entryPath)).size;
    } catch {
      // Ignore files that disappear while aria2 is moving them.
    }
  }));
  return total;
};

const reserveLocalPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address !== "object") {
        server.close();
        reject(new Error("Unable to reserve an aria2 RPC port."));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });

const randomRpcSecret = (): string =>
  `lyra-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;

export const buildAria2Args = (options: Aria2DownloadProcessOptions): readonly string[] => {
  const args = [
    "--dir",
    options.directory,
    "--continue=true",
    "--allow-overwrite=true",
    "--auto-file-renaming=false",
    "--summary-interval=0",
    "--console-log-level=warn",
    "--show-console-readout=false",
    `--enable-dht=${options.dhtEnabled === false ? "false" : "true"}`,
    `--enable-peer-exchange=${options.peerExchangeEnabled === false ? "false" : "true"}`,
    `--bt-enable-lpd=${options.localPeerDiscoveryEnabled === false ? "false" : "true"}`,
    "--follow-torrent=mem",
    "--seed-time",
    String(Math.max(0, Math.round(options.seedTimeMinutes ?? 0))),
    "--max-concurrent-downloads=1",
    "--enable-rpc=true",
    "--rpc-listen-all=false",
    "--rpc-allow-origin-all=false",
    "--rpc-listen-port",
    String(options.rpcPort),
    "--rpc-secret",
    options.rpcSecret
  ];
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    args.push("--header", `${name}: ${value}`);
  }
  if (options.maxBytesPerSecond !== undefined && options.maxBytesPerSecond > 0) {
    args.push("--max-download-limit", `${String(options.maxBytesPerSecond)}B`);
  }
  if (options.maxUploadBytesPerSecond !== undefined && options.maxUploadBytesPerSecond > 0) {
    args.push("--max-upload-limit", `${String(options.maxUploadBytesPerSecond)}B`);
  }
  if (options.proxyUrl !== undefined && options.proxyUrl.length > 0) {
    args.push("--all-proxy", options.proxyUrl);
  }
  const selectedFileIndexes = (options.selectedFileIndexes ?? [])
    .filter((index) => Number.isInteger(index) && index > 0);
  if (selectedFileIndexes.length > 0) {
    args.push("--select-file", selectedFileIndexes.join(","));
  }
  const trackerUrls = (options.trackerUrls ?? []).filter((url) => url.trim().length > 0);
  if (trackerUrls.length > 0) {
    args.push("--bt-tracker", trackerUrls.join(","));
  }
  args.push(options.url);
  return args;
};

const callAria2Rpc = <T>(
  port: number,
  secret: string,
  method: string,
  params: readonly unknown[] = []
): Promise<T> =>
  new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: "lyra",
      method: `aria2.${method}`,
      params: [`token:${secret}`, ...params]
    });
    const request = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/jsonrpc",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      }
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.once("end", () => {
        const statusCode = response.statusCode ?? 0;
        const raw = Buffer.concat(chunks).toString("utf8");
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(raw.trim() || `aria2 RPC returned ${statusCode}`));
          return;
        }
        try {
          const parsed = JSON.parse(raw) as JsonRpcResponse<T>;
          if (parsed.error !== undefined) {
            reject(new Error(parsed.error.message ?? `aria2 RPC error ${parsed.error.code ?? "unknown"}`));
            return;
          }
          resolve(parsed.result as T);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once("error", reject);
    request.end(body);
  });

const numberFromAria2 = (value: string | undefined): number => {
  if (value === undefined || value.length === 0) {
    return 0;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const progressFromStatus = (status: Aria2RpcDownloadStatus): Aria2DownloadEngineUpdate => {
  const files = status.files ?? [];
  const fileTotalBytes = files.reduce((total, file) => total + numberFromAria2(file.length), 0);
  const fileReceivedBytes = files.reduce(
    (total, file) => total + numberFromAria2(file.completedLength),
    0
  );
  return {
    receivedBytes: Math.max(numberFromAria2(status.completedLength), fileReceivedBytes),
    totalBytes: Math.max(numberFromAria2(status.totalLength), fileTotalBytes),
    speedBytesPerSecond: numberFromAria2(status.downloadSpeed),
    connectionsActive: numberFromAria2(status.connections)
  };
};

export class Aria2DownloadController {
  private process: ChildProcess | null = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private canceled = false;
  private paused = false;
  private rpcPort: number | null = null;
  private rpcSecret: string | null = null;
  private lastBytes = 0;
  private lastProgressAt = Date.now();
  private terminalEventDelivered = false;

  public constructor(private readonly options: Aria2DownloadEngineOptions) {}

  public pause(): void {
    if (this.canceled || this.paused) {
      return;
    }
    this.paused = true;
    void this.shutdown().finally(() => {
      if (this.process !== null) {
        terminateManagedChildProcess(this.process);
      }
    });
    this.stopProgress();
    this.options.onPaused();
  }

  public cancel(): void {
    if (this.canceled) {
      return;
    }
    this.canceled = true;
    void this.shutdown().finally(() => {
      if (this.process !== null) {
        terminateManagedChildProcess(this.process);
      }
    });
    this.stopProgress();
    this.options.onCanceled();
  }

  public async start(): Promise<void> {
    try {
      await mkdir(this.options.directory, { recursive: true });
      this.rpcPort = await reserveLocalPort();
      this.rpcSecret = randomRpcSecret();
      this.lastBytes = await getDirectorySize(this.options.directory);
      this.lastProgressAt = Date.now();
      const child = spawnManagedChildProcess(
        this.options.binaryPath,
        buildAria2Args({
          ...this.options,
          rpcPort: this.rpcPort,
          rpcSecret: this.rpcSecret
        }),
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      this.process = child;
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.once("error", (error) => {
        this.stopProgress();
        if (this.shouldIgnoreTerminalEvent()) {
          return;
        }
        this.options.onError(error);
      });
      child.once("close", (code) => {
        this.stopProgress();
        this.process = null;
        if (this.shouldIgnoreTerminalEvent()) {
          return;
        }
        if (code === 0) {
          void this.emitProgress().finally(() => {
            this.options.onComplete();
          });
          return;
        }
        this.options.onError(new Error(stderr.trim() || `aria2c exited with ${code ?? "unknown"}`));
      });
      void this.waitForRpcReady().finally(() => {
        if (this.canceled || this.paused || this.process !== child) {
          return;
        }
        this.startProgress();
      });
    } catch (error) {
      this.stopProgress();
      if (this.canceled || this.paused) {
        return;
      }
      this.options.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private shouldIgnoreTerminalEvent(): boolean {
    if (this.canceled || this.paused || this.terminalEventDelivered) {
      return true;
    }
    this.terminalEventDelivered = true;
    return false;
  }

  private async waitForRpcReady(): Promise<void> {
    const deadline = Date.now() + RPC_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.rpcPort === null || this.rpcSecret === null) {
        return;
      }
      try {
        await callAria2Rpc(this.rpcPort, this.rpcSecret, "getVersion");
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  private async shutdown(): Promise<void> {
    if (this.rpcPort === null || this.rpcSecret === null) {
      return;
    }
    try {
      await callAria2Rpc(this.rpcPort, this.rpcSecret, "shutdown");
    } catch {
      // The process may already be closing after pause/cancel.
    }
  }

  private startProgress(): void {
    this.stopProgress();
    this.progressTimer = setInterval(() => {
      void this.emitProgress();
    }, PROGRESS_INTERVAL_MS);
    void this.emitProgress();
  }

  private stopProgress(): void {
    if (this.progressTimer === null) {
      return;
    }
    clearInterval(this.progressTimer);
    this.progressTimer = null;
  }

  private async readRpcProgress(): Promise<Aria2DownloadEngineUpdate | null> {
    if (this.rpcPort === null || this.rpcSecret === null) {
      return null;
    }
    const [active, waiting, stopped] = await Promise.all([
      callAria2Rpc<readonly Aria2RpcDownloadStatus[]>(this.rpcPort, this.rpcSecret, "tellActive", [RPC_FIELDS]),
      callAria2Rpc<readonly Aria2RpcDownloadStatus[]>(this.rpcPort, this.rpcSecret, "tellWaiting", [0, 1, RPC_FIELDS]),
      callAria2Rpc<readonly Aria2RpcDownloadStatus[]>(this.rpcPort, this.rpcSecret, "tellStopped", [0, 5, RPC_FIELDS])
    ]);
    const status = active[0] ?? waiting[0] ?? stopped[0];
    return status === undefined ? null : progressFromStatus(status);
  }

  private async emitProgress(): Promise<void> {
    const rpcProgress = await this.readRpcProgress().catch(() => null);
    if (rpcProgress !== null) {
      this.options.onUpdate(rpcProgress);
      this.lastBytes = rpcProgress.receivedBytes;
      this.lastProgressAt = Date.now();
      return;
    }
    const receivedBytes = await getDirectorySize(this.options.directory);
    const now = Date.now();
    const elapsedSeconds = Math.max((now - this.lastProgressAt) / 1000, 0.001);
    const speedBytesPerSecond = Math.round((receivedBytes - this.lastBytes) / elapsedSeconds);
    this.lastBytes = receivedBytes;
    this.lastProgressAt = now;
    this.options.onUpdate({
      receivedBytes,
      totalBytes: 0,
      speedBytesPerSecond: Math.max(0, speedBytesPerSecond),
      connectionsActive: 0
    });
  }
}

export const isAria2DownloadUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const lowerPathname = parsed.pathname.toLowerCase();
    return parsed.protocol === "magnet:"
      || (
        (parsed.protocol === "http:" || parsed.protocol === "https:")
        && (
          lowerPathname.endsWith(".torrent")
          || lowerPathname.endsWith(".metalink")
          || lowerPathname.endsWith(".meta4")
        )
      );
  } catch {
    return false;
  }
};
