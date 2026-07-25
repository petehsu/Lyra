import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const networkMocks = vi.hoisted(() => ({
  lookup: vi.fn()
}));

vi.mock("node:dns/promises", () => ({
  default: {
    lookup: networkMocks.lookup
  },
  lookup: networkMocks.lookup
}));

vi.mock("electron", () => ({
  session: {
    defaultSession: undefined
  }
}));

import { createProviderIconCache } from "./provider-icon-cache";

const publicDnsAnswer = [{ address: "93.184.216.34", family: 4 }] as const;
const pngResponse = (): Response => new Response(
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  {
    status: 200,
    headers: {
      "content-type": "image/png"
    }
  }
);

describe("provider icon public-only resolution", () => {
  let storageRoot: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storageRoot = mkdtempSync(path.join(tmpdir(), "lyra-provider-icon-"));
    networkMocks.lookup.mockReset();
    networkMocks.lookup.mockResolvedValue(publicDnsAnswer);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  test("rejects local names and non-public literal addresses before fetching", async () => {
    const cache = createProviderIconCache({ storageRoot });

    for (const url of [
      "http://localhost:3000",
      "http://intranet",
      "http://printer.local",
      "http://10.0.0.8",
      "http://169.254.169.254",
      "http://[::1]",
      "http://[fc00::1]",
      "https://8.8.8.8"
    ]) {
      await expect(cache.resolve(url, { publicOnly: true })).resolves.toEqual({
        iconUrl: null
      });
    }

    expect(networkMocks.lookup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects a hostname when any DNS answer is private", async () => {
    networkMocks.lookup.mockResolvedValue([
      ...publicDnsAnswer,
      { address: "192.168.1.10", family: 4 }
    ]);
    const cache = createProviderIconCache({ storageRoot });

    await expect(
      cache.resolve("https://mixed.example/path", { publicOnly: true })
    ).resolves.toEqual({ iconUrl: null });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("recognizes private IPv4 addresses mapped into IPv6 DNS answers", async () => {
    networkMocks.lookup.mockResolvedValue([
      { address: "::ffff:7f00:1", family: 6 }
    ]);
    const cache = createProviderIconCache({ storageRoot });

    await expect(
      cache.resolve("https://mapped.example/path", { publicOnly: true })
    ).resolves.toEqual({ iconUrl: null });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("revalidates redirects and never follows one into a private target", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: {
          location: "http://127.0.0.1/private"
        }
      }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const cache = createProviderIconCache({ storageRoot });

    await expect(
      cache.resolve("https://public.example/page", { publicOnly: true })
    ).resolves.toEqual({ iconUrl: null });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://public.example/",
      "https://public.example/favicon.ico"
    ]);
  });

  test("caps HTML before parsing icon declarations beyond 512 KiB", async () => {
    const oversizedHtml = `${"x".repeat(512 * 1024 + 1)}`
      + `<link rel="icon" href="https://cdn.example/late.png">`;
    fetchMock
      .mockResolvedValueOnce(new Response(oversizedHtml, { status: 200 }))
      .mockResolvedValueOnce(pngResponse());
    const cache = createProviderIconCache({ storageRoot });

    const result = await cache.resolve("https://large.example/page", {
      publicOnly: true
    });

    expect(result.iconUrl).toMatch(/^lyra-file:\/\/preview\?/u);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://large.example/",
      "https://large.example/favicon.ico"
    ]);
  });

  test("keeps the timeout active while the response body is streaming", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockImplementationOnce((_url, init) => Promise.resolve(new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("<html>"));
            (init as RequestInit | undefined)?.signal?.addEventListener("abort", () => {
              controller.error(new DOMException("Aborted", "AbortError"));
            });
          }
        }),
        { status: 200 }
      )))
      .mockRejectedValueOnce(new Error("fallback unavailable"));
    const cache = createProviderIconCache({ storageRoot });

    const pending = cache.resolve("https://slow.example/page", {
      publicOnly: true
    });
    await vi.advanceTimersByTimeAsync(8_001);

    await expect(pending).resolves.toEqual({ iconUrl: null });
  });

  test("shares one in-flight result for concurrent requests to the same origin", async () => {
    let releaseHtml: ((response: Response) => void) | undefined;
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        releaseHtml = resolve;
      }))
      .mockResolvedValueOnce(pngResponse());
    const cache = createProviderIconCache({ storageRoot });

    const first = cache.resolve("https://shared.example/one", { publicOnly: true });
    const second = cache.resolve("https://shared.example/two", { publicOnly: true });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    releaseHtml?.(new Response(
      `<link rel="icon" href="/assets/icon.png">`,
      { status: 200 }
    ));

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.iconUrl).toMatch(/^lyra-file:\/\/preview\?/u);
    expect(secondResult).toEqual(firstResult);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(
      cache.resolve("https://shared.example/three", { publicOnly: true })
    ).resolves.toEqual(firstResult);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("keeps the default provider mode permissive for local endpoints", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(
        `<link rel="icon" href="/provider.png">`,
        { status: 200 }
      ))
      .mockResolvedValueOnce(pngResponse());
    const cache = createProviderIconCache({ storageRoot });

    const result = await cache.resolve("http://localhost:11434/v1");

    expect(result.iconUrl).toMatch(/^lyra-file:\/\/preview\?/u);
    expect(networkMocks.lookup).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
