import assert from "node:assert/strict";
import test from "node:test";

import { parseDownloadsSnapshot } from "./src/parse.ts";

test("keeps Core download rows with defaults for optional fields", () => {
  const snapshot = parseDownloadsSnapshot({
    tasks: [{
      id: "download-1",
      url: "https://example.com/archive.zip",
      fileName: "archive.zip",
      savePath: "/Downloads/archive.zip",
      state: "downloading",
      receivedBytes: 512,
      totalBytes: 1024,
      speedBytesPerSecond: 128,
      canResume: true
    }]
  });
  assert.equal(snapshot.tasks[0]?.fileName, "archive.zip");
  assert.equal(snapshot.tasks[0]?.source, "manual");
  assert.equal(snapshot.tasks[0]?.priority, "normal");
  assert.equal(snapshot.tasks[0]?.connectionsRequested, 1);
});

test("rejects a Core payload without a task array", () => {
  assert.throws(
    () => parseDownloadsSnapshot({}),
    /invalid download snapshot/u
  );
});
