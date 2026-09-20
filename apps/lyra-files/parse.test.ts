import assert from "node:assert/strict";
import test from "node:test";

import { parseFilesModuleState } from "./src/parse.ts";

test("keeps Core directory rows and optional host facts", () => {
  const state = parseFilesModuleState({
    instanceId: "files-1",
    status: "ready",
    viewKind: "directory",
    presentationMode: "list",
    title: "src",
    currentLocation: { id: "/project/src", title: "src", kind: "directory", path: "/project/src" },
    history: [{ id: "/project/src", title: "src", kind: "directory", path: "/project/src" }],
    historyIndex: 0,
    systemLocations: [],
    favorites: [],
    recentLocations: [],
    hostInfo: {
      name: "lyra-dev",
      osName: "Linux",
      architecture: "x64",
      cpuBrand: "Test CPU",
      memoryTotalBytes: 16,
      memoryUsedBytes: 8
    },
    disks: [{
      id: "disk-1",
      title: "System",
      mountPath: "/",
      kind: "system",
      totalBytes: 100,
      usedBytes: 40,
      availableBytes: 60,
      usageRatio: 0.4
    }],
    devices: [],
    entries: [{
      id: "file-1", name: "index.ts", path: "/project/src/index.ts",
      kind: "file", sizeBytes: 128
    }],
    trashEntries: [],
    downloadTasks: []
  });
  assert.equal(state?.entries[0]?.name, "index.ts");
  assert.equal(state?.hostInfo?.name, "lyra-dev");
  assert.equal(state?.disks[0]?.usageRatio, 0.4);
});

test("rejects a Core payload without a Files title", () => {
  assert.throws(
    () => parseFilesModuleState({ instanceId: "files-1", status: "ready" }),
    /invalid Files state/u
  );
});
