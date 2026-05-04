import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  DownloadManagerEnqueueRequest,
  DownloadManagerSettings,
  DownloadManagerSnapshot
} from "../../../shared/download-manager";
import {
  createDownloadManagerRemoteApi,
  type DownloadManagerRemoteApiController
} from "../remote-api";

const tempDirs: string[] = [];
const controllers: DownloadManagerRemoteApiController[] = [];

afterEach(async () => {
  for (const controller of controllers.splice(0)) {
    controller.dispose();
  }
  for (const tempDir of tempDirs.splice(0)) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

const emptySnapshot: DownloadManagerSnapshot = {
  tasks: []
};

const emptySettings: DownloadManagerSettings = {
  version: 1,
  speedLimitBytesPerSecond: null,
  schedule: null,
  proxy: {
    mode: "system"
  },
  postProcessing: {
    autoExtract: false,
    deleteArchiveAfterExtract: false,
    detectSplitArchives: true
  },
  bt: {
    dhtEnabled: true,
    peerExchangeEnabled: true,
    localPeerDiscoveryEnabled: true,
    seedTimeMinutes: 0,
    trackerUrls: [],
    maxUploadBytesPerSecond: null
  },
  defaultHeaders: {},
  defaultCookieHeader: null,
  saveRules: [],
  updatedAt: "2026-05-04T00:00:00.000Z"
};

describe("Download manager remote API", () => {
  test("requires bearer auth and forwards enqueue requests", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lyra-download-remote-api-"));
    tempDirs.push(tempDir);
    const enqueue = vi.fn((request: DownloadManagerEnqueueRequest) => ({
      tasks: [{
        id: "download-1",
        url: request.urls?.[0] ?? "https://example.com/file.zip",
        fileName: "file.zip",
        savePath: "/tmp/file.zip",
        directory: "/tmp",
        protocol: "https",
        source: "manual" as const,
        state: "queued" as const,
        receivedBytes: 0,
        totalBytes: 0,
        speedBytesPerSecond: 0,
        priority: "normal" as const,
        connectionsRequested: 4,
        connectionsActive: 0,
        canResume: true,
        createdAt: "2026-05-04T00:00:00.000Z",
        updatedAt: "2026-05-04T00:00:00.000Z",
        tags: []
      }]
    }));

    const controller = createDownloadManagerRemoteApi({
      storageRoot: tempDir,
      handlers: {
        readSnapshot: () => emptySnapshot,
        enqueue,
        pauseTask: () => null,
        resumeTask: () => null,
        cancelTask: () => null,
        retryTask: () => null,
        removeTask: () => undefined,
        setTaskPriority: () => null,
        pauseAll: () => emptySnapshot,
        resumeAll: () => emptySnapshot,
        cancelAll: () => emptySnapshot,
        readSettings: () => emptySettings,
        updateSettings: (request) => ({
          ...emptySettings,
          speedLimitBytesPerSecond:
            request.speedLimitBytesPerSecond ?? emptySettings.speedLimitBytesPerSecond,
          saveRules: request.saveRules ?? emptySettings.saveRules
        })
      }
    });
    controllers.push(controller);

    const status = await controller.start({ host: "127.0.0.1", port: 0 });
    expect(status.baseUrl).not.toBeNull();

    const webUi = await fetch(`${status.baseUrl}/`);
    expect(webUi.status).toBe(200);
    expect(await webUi.text()).toContain("Lyra Downloads");

    const unauthorized = await fetch(`${status.baseUrl}/api/downloads`);
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${status.baseUrl}/api/downloads`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${status.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        urls: ["https://example.com/file.zip"]
      })
    });
    expect(authorized.status).toBe(200);
    expect((await authorized.json()) as DownloadManagerSnapshot).toMatchObject({
      tasks: [{ id: "download-1" }]
    });
    expect(enqueue).toHaveBeenCalledWith({
      urls: ["https://example.com/file.zip"]
    });

    const settings = await fetch(`${status.baseUrl}/api/settings`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${status.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        speedLimitBytesPerSecond: 1024
      })
    });
    expect(settings.status).toBe(200);
    expect((await settings.json()) as DownloadManagerSettings).toMatchObject({
      speedLimitBytesPerSecond: 1024
    });
  });
});
