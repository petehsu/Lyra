import { describe, expect, test } from "vitest";

import type { DownloadManagerTask } from "../../../shared/download-manager";
import { restoreDownloadTaskForStartup } from "../task-persistence";

const baseTask = (
  state: DownloadManagerTask["state"]
): DownloadManagerTask => ({
  id: `download-${state}`,
  url: "https://example.com/file.zip",
  fileName: "file.zip",
  savePath: "/tmp/file.zip",
  directory: "/tmp",
  protocol: "https",
  source: "manual",
  state,
  receivedBytes: 1024,
  totalBytes: 4096,
  speedBytesPerSecond: 512,
  priority: "normal",
  connectionsRequested: 4,
  connectionsActive: 2,
  canResume: false,
  createdAt: "2026-05-04T00:00:00.000Z",
  updatedAt: "2026-05-04T00:00:01.000Z",
  errorMessage: "Previous error",
  tags: []
});

const defaults = {
  maxRetries: 3,
  retryDelayMs: 1500,
  nowIso: () => "2026-05-04T00:00:02.000Z"
};

describe("restoreDownloadTaskForStartup", () => {
  test("returns active tasks to a resumable queue without marking them failed", () => {
    const restored = restoreDownloadTaskForStartup(baseTask("downloading"), defaults);

    expect(restored).toMatchObject({
      state: "queued",
      speedBytesPerSecond: 0,
      connectionsActive: 0,
      canResume: true,
      errorMessage: undefined,
      retryCount: 0,
      maxRetries: 3,
      retryDelayMs: 1500
    });
  });

  test("keeps paused tasks paused and resumable", () => {
    const restored = restoreDownloadTaskForStartup(baseTask("paused"), defaults);

    expect(restored.state).toBe("paused");
    expect(restored.canResume).toBe(true);
    expect(restored.errorMessage).toBeUndefined();
  });

  test("does not revive terminal tasks", () => {
    expect(restoreDownloadTaskForStartup(baseTask("completed"), defaults)).toMatchObject({
      state: "completed",
      canResume: false,
      errorMessage: "Previous error"
    });
    expect(restoreDownloadTaskForStartup(baseTask("canceled"), defaults)).toMatchObject({
      state: "canceled",
      canResume: false,
      errorMessage: "Previous error"
    });
  });
});
