import { describe, expect, test } from "vitest";

import {
  buildAria2Args,
  isAria2DownloadUrl,
  type Aria2DownloadProcessOptions
} from "../aria2-engine";

const processOptions = (
  overrides: Partial<Aria2DownloadProcessOptions> = {}
): Aria2DownloadProcessOptions => ({
  taskId: "download-test",
  url: "magnet:?xt=urn:btih:abc&dn=Example",
  directory: "/tmp/lyra-downloads",
  binaryPath: "/usr/bin/aria2c",
  rpcPort: 16800,
  rpcSecret: "secret",
  onUpdate: () => undefined,
  onComplete: () => undefined,
  onError: () => undefined,
  onPaused: () => undefined,
  onCanceled: () => undefined,
  ...overrides
});

describe("aria2 engine", () => {
  test("routes magnet, torrent, and Metalink urls to aria2", () => {
    expect(isAria2DownloadUrl("magnet:?xt=urn:btih:abc&dn=Example")).toBe(true);
    expect(isAria2DownloadUrl("https://example.com/file.torrent")).toBe(true);
    expect(isAria2DownloadUrl("https://example.com/file.metalink")).toBe(true);
    expect(isAria2DownloadUrl("https://example.com/file.meta4")).toBe(true);
    expect(isAria2DownloadUrl("https://example.com/file.zip")).toBe(false);
  });

  test("builds BT-capable aria2 arguments with RPC, headers, proxy, and limits", () => {
    const args = buildAria2Args(processOptions({
      headers: {
        Cookie: "sid=1"
      },
      maxBytesPerSecond: 2048,
      proxyUrl: "socks5://127.0.0.1:1080"
    }));

    expect(args).toContain("--enable-dht=true");
    expect(args).toContain("--enable-peer-exchange=true");
    expect(args).toContain("--bt-enable-lpd=true");
    expect(args).toContain("--follow-torrent=mem");
    expect(args).toContain("--enable-rpc=true");
    expect(args).toContain("--rpc-listen-port");
    expect(args).toContain("16800");
    expect(args).toContain("--rpc-secret");
    expect(args).toContain("secret");
    expect(args).toContain("--header");
    expect(args).toContain("Cookie: sid=1");
    expect(args).toContain("--max-download-limit");
    expect(args).toContain("2048B");
    expect(args).toContain("--all-proxy");
    expect(args).toContain("socks5://127.0.0.1:1080");
  });

  test("maps BT settings into aria2 arguments", () => {
    const args = buildAria2Args(processOptions({
      dhtEnabled: false,
      peerExchangeEnabled: false,
      localPeerDiscoveryEnabled: false,
      selectedFileIndexes: [3, 1],
      seedTimeMinutes: 45,
      maxUploadBytesPerSecond: 1024,
      trackerUrls: [
        "udp://tracker.example.com:80/announce",
        "https://tracker.example.com/announce"
      ]
    }));

    expect(args).toContain("--enable-dht=false");
    expect(args).toContain("--enable-peer-exchange=false");
    expect(args).toContain("--bt-enable-lpd=false");
    expect(args).toContain("--seed-time");
    expect(args).toContain("45");
    expect(args).toContain("--select-file");
    expect(args).toContain("3,1");
    expect(args).toContain("--max-upload-limit");
    expect(args).toContain("1024B");
    expect(args).toContain("--bt-tracker");
    expect(args).toContain("udp://tracker.example.com:80/announce,https://tracker.example.com/announce");
  });
});
