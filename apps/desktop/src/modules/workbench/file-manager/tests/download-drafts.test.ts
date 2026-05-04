import { describe, expect, test } from "vitest";

import {
  buildDownloadEnqueueRequest,
  buildDownloadSettingsUpdate,
  createDownloadAdvancedDraft,
  createDownloadSettingsDraft
} from "../download-drafts";

describe("download draft helpers", () => {
  test("builds an advanced enqueue request from the add form draft", () => {
    const request = buildDownloadEnqueueRequest("https://example.com/file.zip", {
      ...createDownloadAdvancedDraft(),
      cookieHeader: "sid=1",
      headersText: "Authorization: Bearer token",
      mirrorsText: "https://mirror.example.com/file.zip",
      btSelectedFileIndexesText: "1, 3",
      btTrackerUrlsText: "udp://tracker.example.com:80/announce",
      partialFilePath: "/Users/petehsu/Downloads/file.zip.crdownload",
      checksumAlgorithm: "sha256",
      checksumExpected: "abc123",
      maxRetries: "5",
      retryDelaySeconds: "3",
      proxyMode: "http",
      proxyUrl: "http://127.0.0.1:8080"
    });

    expect(request).toMatchObject({
      text: "https://example.com/file.zip",
      headers: {
        Authorization: "Bearer token"
      },
      cookieHeader: "sid=1",
      mirrors: ["https://mirror.example.com/file.zip"],
      bt: {
        selectedFileIndexes: [1, 3],
        trackerUrls: ["udp://tracker.example.com:80/announce"]
      },
      partialFilePath: "/Users/petehsu/Downloads/file.zip.crdownload",
      checksum: {
        algorithm: "sha256",
        expected: "abc123"
      },
      maxRetries: 5,
      retryDelayMs: 3000,
      proxy: {
        mode: "http",
        url: "http://127.0.0.1:8080"
      }
    });
  });

  test("builds schedule and save-rule settings updates", () => {
    const draft = createDownloadSettingsDraft(
      {
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
      },
      null
    );

    const update = buildDownloadSettingsUpdate({
      ...draft,
      speedLimitKibPerSecond: "1024",
      scheduleEnabled: true,
      scheduleStartTime: "01:30",
      scheduleEndTime: "09:15",
      scheduleOutsideAction: "speed-limit",
      scheduleOutsideSpeedLimitKibPerSecond: "128",
      btDhtEnabled: false,
      btPeerExchangeEnabled: true,
      btLocalPeerDiscoveryEnabled: false,
      btSeedTimeMinutes: "30",
      btTrackerUrlsText: "udp://tracker.example.com:80/announce",
      btUploadLimitKibPerSecond: "64",
      saveRules: [
        {
          id: "rule-1",
          enabled: true,
          name: "Archives",
          directory: "/tmp/archives",
          extensionsText: "zip, 7z",
          hostContainsText: "example.com",
          protocolsText: "https",
          tagsText: "archive, installer"
        }
      ]
    });

    expect(update.speedLimitBytesPerSecond).toBe(1024 * 1024);
    expect(update.schedule).toEqual({
      enabled: true,
      startMinuteOfDay: 90,
      endMinuteOfDay: 555,
      outsideAction: "speed-limit",
      outsideSpeedLimitBytesPerSecond: 128 * 1024
    });
    expect(update.bt).toEqual({
      dhtEnabled: false,
      peerExchangeEnabled: true,
      localPeerDiscoveryEnabled: false,
      seedTimeMinutes: 30,
      trackerUrls: ["udp://tracker.example.com:80/announce"],
      maxUploadBytesPerSecond: 64 * 1024
    });
    expect(update.saveRules).toEqual([
      {
        id: "rule-1",
        enabled: true,
        name: "Archives",
        directory: "/tmp/archives",
        extensions: ["zip", "7z"],
        hostContains: ["example.com"],
        protocols: ["https"],
        tags: ["archive", "installer"]
      }
    ]);
  });
});
