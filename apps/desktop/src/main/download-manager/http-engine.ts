import http, { type IncomingMessage, type RequestOptions } from "node:http";
import https from "node:https";
import {
  createReadStream,
  createWriteStream,
  type WriteStream
} from "node:fs";
import {
  mkdir,
  rename,
  rm,
  stat
} from "node:fs/promises";
import path from "node:path";

import {
  isNativeHttpFamilyDownloadUrl,
  toHttpDownloadTransportUrl
} from "./transport-url";
import { planDownloadSegmentsWithNativeFallback } from "./native-planner";

const DEFAULT_MAX_REDIRECTS = 8;
const PROGRESS_INTERVAL_MS = 250;
const MIN_MULTI_CONNECTION_BYTES = 2 * 1024 * 1024;

export type HttpDownloadEngineUpdate = {
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly speedBytesPerSecond: number;
  readonly connectionsActive: number;
};

export type HttpDownloadEngineCompletion = {
  readonly finalUrl: string;
  readonly totalBytes: number;
};

export type HttpDownloadEngineOptions = {
  readonly taskId: string;
  readonly url: string;
  readonly savePath: string;
  readonly partsRoot: string;
  readonly connections: number;
  readonly maxBytesPerSecond?: number | undefined;
  readonly headers?: Readonly<Record<string, string>>;
  readonly onUpdate: (update: HttpDownloadEngineUpdate) => void;
  readonly onComplete: (completion: HttpDownloadEngineCompletion) => void;
  readonly onError: (error: Error) => void;
  readonly onPaused: () => void;
  readonly onCanceled: () => void;
};

type RemoteFileInfo = {
  readonly finalUrl: string;
  readonly totalBytes: number;
  readonly supportsRanges: boolean;
};

type DownloadSegment = {
  readonly index: number;
  readonly start: number;
  readonly end: number | null;
  readonly partPath: string;
};

type SegmentProgress = {
  readonly initialBytes: number;
  currentBytes: number;
};

const isRedirectStatus = (statusCode: number): boolean =>
  statusCode >= 300 && statusCode < 400;

const parseContentLength = (value: string | string[] | undefined): number => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) {
    return 0;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const supportsByteRanges = (value: string | string[] | undefined): boolean => {
  const raw = Array.isArray(value) ? value.join(",") : value ?? "";
  return raw.toLowerCase().split(",").map((part) => part.trim()).includes("bytes");
};

const requestWithRedirects = (
  url: string,
  options: RequestOptions,
  redirectCount = 0
): Promise<{ readonly response: IncomingMessage; readonly finalUrl: string }> =>
  new Promise((resolve, reject) => {
    const transportUrl = toHttpDownloadTransportUrl(url);
    const parsed = new URL(transportUrl);
    const client = parsed.protocol === "https:" ? https : http;
    const request = client.request(parsed, options, (response) => {
      const statusCode = response.statusCode ?? 0;
      const location = response.headers.location;
      if (isRedirectStatus(statusCode) && typeof location === "string" && location.length > 0) {
        response.resume();
        if (redirectCount >= DEFAULT_MAX_REDIRECTS) {
          reject(new Error("too many redirects"));
          return;
        }
        const nextUrl = new URL(location, transportUrl).toString();
        void requestWithRedirects(nextUrl, options, redirectCount + 1).then(resolve, reject);
        return;
      }
      resolve({ response, finalUrl: url });
    });
    request.on("error", reject);
    request.end();
  });

const readRemoteFileInfo = async (
  url: string,
  headers: Readonly<Record<string, string>> | undefined
): Promise<RemoteFileInfo> => {
  const { response, finalUrl } = await requestWithRedirects(url, {
    method: "HEAD",
    headers: headers === undefined ? undefined : { ...headers }
  });
  response.resume();
  const statusCode = response.statusCode ?? 0;
  if (statusCode >= 400) {
    throw new Error(`server returned ${statusCode}`);
  }
  return {
    finalUrl,
    totalBytes: parseContentLength(response.headers["content-length"]),
    supportsRanges: supportsByteRanges(response.headers["accept-ranges"])
  };
};

const getFileSize = async (filePath: string): Promise<number> => {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
};

const buildSegments = (
  totalBytes: number,
  connectionCount: number,
  partsDirectory: string
): readonly DownloadSegment[] => {
  const fallback = (): readonly Omit<DownloadSegment, "partPath">[] => {
    if (totalBytes <= 0 || connectionCount <= 1) {
      return [
        {
          index: 0,
          start: 0,
          end: totalBytes > 0 ? totalBytes - 1 : null
        }
      ];
    }

    const segmentSize = Math.ceil(totalBytes / connectionCount);
    return Array.from({ length: connectionCount }, (_value, index) => {
      const start = index * segmentSize;
      const end = Math.min(totalBytes - 1, start + segmentSize - 1);
      return {
        index,
        start,
        end
      };
    }).filter((segment) => segment.end === null || segment.start <= segment.end);
  };

  return planDownloadSegmentsWithNativeFallback({
    url: "http://lyra.local/download",
    totalBytes,
    requestedConnections: connectionCount,
    minSegmentBytes: 1
  }, fallback).map((segment) => ({
    ...segment,
    partPath: path.join(partsDirectory, `segment-${segment.index}.part`)
  }));
};

const pipePartInto = (
  partPath: string,
  output: WriteStream
): Promise<void> =>
  new Promise((resolve, reject) => {
    const input = createReadStream(partPath);
    input.on("error", reject);
    output.on("error", reject);
    input.on("end", resolve);
    input.pipe(output, { end: false });
  });

export class HttpDownloadController {
  private readonly requests = new Set<http.ClientRequest>();
  private canceled = false;
  private paused = false;
  private throttleWindowStartedAt = Date.now();
  private throttleWindowBytes = 0;

  public constructor(private readonly options: HttpDownloadEngineOptions) {}

  public pause(): void {
    if (this.canceled || this.paused) {
      return;
    }
    this.paused = true;
    for (const request of this.requests) {
      request.destroy(new Error("download paused"));
    }
    this.requests.clear();
    this.options.onPaused();
  }

  public cancel(): void {
    if (this.canceled) {
      return;
    }
    this.canceled = true;
    for (const request of this.requests) {
      request.destroy(new Error("download canceled"));
    }
    this.requests.clear();
    this.options.onCanceled();
  }

  public async start(): Promise<void> {
    try {
      const info = await readRemoteFileInfo(this.options.url, this.options.headers);
      if (this.canceled || this.paused) {
        return;
      }
      const connections = info.supportsRanges && info.totalBytes >= MIN_MULTI_CONNECTION_BYTES
        ? Math.max(1, Math.min(16, this.options.connections))
        : 1;
      const partsDirectory = path.join(this.options.partsRoot, this.options.taskId);
      await mkdir(partsDirectory, { recursive: true });
      const segments = buildSegments(info.totalBytes, connections, partsDirectory);
      const progress = new Map<number, SegmentProgress>();
      for (const segment of segments) {
        const currentBytes = await getFileSize(segment.partPath);
        progress.set(segment.index, {
          initialBytes: currentBytes,
          currentBytes
        });
      }
      this.emitProgress(progress, info.totalBytes, 0, segments.length, true);
      await Promise.all(
        segments.map((segment) => this.downloadSegment(info.finalUrl, segment, progress, info.totalBytes, connections > 1))
      );
      if (this.canceled || this.paused) {
        return;
      }
      await this.mergeSegments(segments, partsDirectory);
      this.options.onComplete({
        finalUrl: info.finalUrl,
        totalBytes: info.totalBytes
      });
    } catch (error) {
      if (this.canceled || this.paused) {
        return;
      }
      this.options.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private emitProgress(
    progress: ReadonlyMap<number, SegmentProgress>,
    totalBytes: number,
    speedBytesPerSecond: number,
    connectionsActive: number,
    force = false
  ): void {
    const receivedBytes = [...progress.values()]
      .reduce((sum, item) => sum + item.currentBytes, 0);
    if (force || receivedBytes <= totalBytes || totalBytes <= 0) {
      this.options.onUpdate({
        receivedBytes,
        totalBytes,
        speedBytesPerSecond,
        connectionsActive
      });
    }
  }

  private async downloadSegment(
    url: string,
    segment: DownloadSegment,
    progress: Map<number, SegmentProgress>,
    totalBytes: number,
    useRange: boolean
  ): Promise<void> {
    const segmentProgress = progress.get(segment.index);
    if (segmentProgress === undefined) {
      throw new Error("segment progress missing");
    }
    const existingBytes = segmentProgress.initialBytes;
    if (segment.end !== null && segment.start + existingBytes > segment.end) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const start = segment.start + existingBytes;
      const headers: Record<string, string> = {
        ...(this.options.headers ?? {})
      };
      if (useRange && segment.end !== null) {
        headers.Range = `bytes=${start}-${segment.end}`;
      }
      const requestOptions: RequestOptions = {
        method: "GET",
        headers
      };
      const parsed = new URL(url);
      const client = parsed.protocol === "https:" ? https : http;
      const request = client.request(parsed, requestOptions, (response) => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode >= 400) {
          response.resume();
          reject(new Error(`server returned ${statusCode}`));
          return;
        }
        if (useRange && statusCode !== 206) {
          response.resume();
          reject(new Error("server did not honor range request"));
          return;
        }

        const output = createWriteStream(segment.partPath, { flags: "a" });
        let lastEmitAt = Date.now();
        let lastBytes = segmentProgress.currentBytes;
        response.on("data", (chunk: Buffer) => {
          segmentProgress.currentBytes += chunk.length;
          this.applyThrottle(response, chunk.length);
          const now = Date.now();
          if (now - lastEmitAt >= PROGRESS_INTERVAL_MS) {
            const elapsedSeconds = Math.max((now - lastEmitAt) / 1000, 0.001);
            const speedBytesPerSecond = Math.round((segmentProgress.currentBytes - lastBytes) / elapsedSeconds);
            lastEmitAt = now;
            lastBytes = segmentProgress.currentBytes;
            this.emitProgress(progress, totalBytes, speedBytesPerSecond, this.requests.size);
          }
        });
        response.on("error", reject);
        output.on("error", reject);
        output.on("finish", () => {
          this.emitProgress(progress, totalBytes, 0, this.requests.size, true);
          resolve();
        });
        response.pipe(output);
      });
      request.on("error", (error) => {
        if (this.paused || this.canceled) {
          resolve();
          return;
        }
        reject(error);
      });
      request.on("close", () => {
        this.requests.delete(request);
      });
      this.requests.add(request);
      request.end();
    });
  }

  private applyThrottle(response: IncomingMessage, chunkBytes: number): void {
    const limit = this.options.maxBytesPerSecond;
    if (limit === undefined || limit <= 0) {
      return;
    }
    const now = Date.now();
    const elapsedMs = now - this.throttleWindowStartedAt;
    if (elapsedMs > 2_000 && this.throttleWindowBytes < limit) {
      this.throttleWindowStartedAt = now;
      this.throttleWindowBytes = 0;
    }
    this.throttleWindowBytes += chunkBytes;
    const expectedMs = Math.round((this.throttleWindowBytes / limit) * 1000);
    const delayMs = expectedMs - (now - this.throttleWindowStartedAt);
    if (delayMs <= 5) {
      return;
    }
    response.pause();
    setTimeout(() => {
      if (this.canceled || this.paused) {
        return;
      }
      response.resume();
    }, Math.min(delayMs, 1_000));
  }

  private async mergeSegments(
    segments: readonly DownloadSegment[],
    partsDirectory: string
  ): Promise<void> {
    await mkdir(path.dirname(this.options.savePath), { recursive: true });
    const tempPath = `${this.options.savePath}.lyra-download`;
    await rm(tempPath, { force: true });
    const output = createWriteStream(tempPath, { flags: "wx" });
    try {
      for (const segment of [...segments].sort((left, right) => left.index - right.index)) {
        await pipePartInto(segment.partPath, output);
      }
      await new Promise<void>((resolve, reject) => {
        output.end((error?: Error | null) => {
          if (error !== undefined && error !== null) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await rm(this.options.savePath, { force: true });
      await rename(tempPath, this.options.savePath);
      await rm(partsDirectory, { recursive: true, force: true });
    } catch (error) {
      output.destroy();
      throw error;
    }
  }
}

export const isNativeHttpDownloadUrl = (url: string): boolean => {
  return isNativeHttpFamilyDownloadUrl(url);
};
