import { describe, expect, test } from "vitest";

import type { DownloadManagerTask } from "../../../shared/download-manager";
import { sortDownloadQueueTaskIds } from "../queue";

const createTask = (
  id: string,
  createdAt: string,
  priority: DownloadManagerTask["priority"]
): DownloadManagerTask => ({
  id,
  url: `https://example.com/${id}.zip`,
  fileName: `${id}.zip`,
  savePath: `/tmp/${id}.zip`,
  directory: "/tmp",
  protocol: "https",
  source: "manual",
  state: "queued",
  receivedBytes: 0,
  totalBytes: 100,
  speedBytesPerSecond: 0,
  priority,
  connectionsRequested: 4,
  connectionsActive: 0,
  canResume: true,
  createdAt,
  updatedAt: createdAt,
  tags: []
});

describe("sortDownloadQueueTaskIds", () => {
  test("orders queued tasks by priority before creation time", () => {
    const tasks = new Map<string, DownloadManagerTask>([
      ["normal-new", createTask("normal-new", "2026-05-04T00:00:03.000Z", "normal")],
      ["high-new", createTask("high-new", "2026-05-04T00:00:04.000Z", "high")],
      ["low-old", createTask("low-old", "2026-05-04T00:00:01.000Z", "low")],
      ["high-old", createTask("high-old", "2026-05-04T00:00:02.000Z", "high")]
    ]);

    expect(sortDownloadQueueTaskIds(
      ["normal-new", "low-old", "high-new", "high-old"],
      tasks
    )).toEqual(["high-old", "high-new", "normal-new", "low-old"]);
  });
});
