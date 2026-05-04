import http from "node:http";
import https from "node:https";

import {
  isNativeHttpFamilyDownloadUrl,
  toHttpDownloadTransportUrl
} from "./transport-url";

const DEFAULT_PROBE_TIMEOUT_MS = 1500;
const MAX_PROBE_REDIRECTS = 5;

export type DownloadMirrorProbeResult = {
  readonly url: string;
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly finalUrl?: string | undefined;
  readonly errorMessage?: string | undefined;
};

export type DownloadMirrorProbeOptions = {
  readonly urls: readonly string[];
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly timeoutMs?: number | undefined;
};

const uniqueUrls = (urls: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const url of urls) {
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    next.push(url);
  }
  return next;
};

const isRedirectStatus = (statusCode: number): boolean =>
  statusCode >= 300 && statusCode < 400;

const probeHttpMirror = (
  url: string,
  headers: Readonly<Record<string, string>> | undefined,
  timeoutMs: number,
  redirectCount = 0,
  startedAt = Date.now()
): Promise<DownloadMirrorProbeResult> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (result: DownloadMirrorProbeResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    let parsed: URL;
    try {
      parsed = new URL(toHttpDownloadTransportUrl(url));
    } catch (error) {
      finish({
        url,
        ok: false,
        latencyMs: Number.POSITIVE_INFINITY,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    const client = parsed.protocol === "https:" ? https : http;
    const request = client.request(
      parsed,
      {
        method: "HEAD",
        headers: headers === undefined ? undefined : { ...headers }
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;
        response.resume();
        if (
          isRedirectStatus(statusCode)
          && typeof location === "string"
          && location.length > 0
          && redirectCount < MAX_PROBE_REDIRECTS
        ) {
          const nextUrl = new URL(location, parsed).toString();
          void probeHttpMirror(
            nextUrl,
            headers,
            timeoutMs,
            redirectCount + 1,
            startedAt
          ).then((result) => {
            finish({
              ...result,
              url,
              finalUrl: result.finalUrl ?? nextUrl
            });
          });
          return;
        }
        if (statusCode >= 200 && statusCode < 400) {
          finish({
            url,
            ok: true,
            latencyMs: Math.max(1, Date.now() - startedAt),
            finalUrl: parsed.toString()
          });
          return;
        }
        finish({
          url,
          ok: false,
          latencyMs: Number.POSITIVE_INFINITY,
          errorMessage: `server returned ${statusCode}`
        });
      }
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("mirror probe timed out"));
    });
    request.on("error", (error) => {
      finish({
        url,
        ok: false,
        latencyMs: Number.POSITIVE_INFINITY,
        errorMessage: error.message
      });
    });
    request.end();
  });

export const probeDownloadMirrors = async ({
  urls,
  headers,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS
}: DownloadMirrorProbeOptions): Promise<readonly DownloadMirrorProbeResult[]> => {
  const candidates = uniqueUrls(urls);
  return Promise.all(
    candidates.map((url) => {
      if (isNativeHttpFamilyDownloadUrl(url) === false) {
        return Promise.resolve({
          url,
          ok: false,
          latencyMs: Number.POSITIVE_INFINITY,
          errorMessage: "unsupported probe protocol"
        });
      }
      return probeHttpMirror(url, headers, timeoutMs);
    })
  );
};

export const sortDownloadMirrorsByProbe = async (
  options: DownloadMirrorProbeOptions
): Promise<readonly string[]> => {
  const candidates = uniqueUrls(options.urls);
  if (candidates.length <= 1) {
    return candidates;
  }
  const results = await probeDownloadMirrors({
    ...options,
    urls: candidates
  });
  const successfulUrls = new Set(results.filter((result) => result.ok).map((result) => result.url));
  if (successfulUrls.size === 0) {
    return candidates;
  }
  return [
    ...results
      .filter((result) => result.ok)
      .sort((left, right) => left.latencyMs - right.latencyMs)
      .map((result) => result.url),
    ...candidates.filter((url) => successfulUrls.has(url) === false)
  ];
};
