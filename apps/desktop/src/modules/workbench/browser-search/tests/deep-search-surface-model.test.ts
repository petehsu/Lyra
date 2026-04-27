import { describe, expect, test, vi } from "vitest";

import type { SearchDeepSnapshot } from "../../../../shared/desktop-bridge";
import {
  filterDeepSearchSnapshotBySource,
  openDeepSearchNode,
  revealDeepSearchNode
} from "../deep-search-surface-model";

const createSnapshot = (): SearchDeepSnapshot => ({
  query: "lyra",
  budgetPreset: "medium",
  phase: "completed",
  nodes: [
    { id: "root", kind: "root_query", title: "lyra", status: "ready" },
    { id: "web", kind: "web_page", title: "Lyra Web", status: "ready", metadata: { url: "https://lyra.test" } },
    { id: "local", kind: "local_result", title: "lyra.md", status: "ready", metadata: { path: "/tmp/lyra.md" } }
  ],
  edges: [
    { id: "root-web", sourceId: "root", targetId: "web", kind: "discovered_from" },
    { id: "root-local", sourceId: "root", targetId: "local", kind: "discovered_from" },
    { id: "web-local", sourceId: "web", targetId: "local", kind: "related_to" }
  ],
  web: {
    status: "ready",
    engineBuckets: [],
    blendedCount: 1
  },
  local: {
    status: "ready",
    scopePreset: "home",
    roots: [],
    elapsedMs: 0,
    stats: {
      scannedFiles: 1,
      scannedDirs: 1,
      contentScannedFiles: 1,
      matchedFiles: 1,
      skippedUnreadable: 0,
      skippedBinaryOrTooLarge: 0,
      usedIndex: false
    }
  },
  stats: {
    dedupedResults: 0,
    derivedQueries: 0,
    expansionRounds: 0
  },
  lastUpdatedAt: "2026-04-27T00:00:00.000Z"
});

describe("deep search surface model", () => {
  test("filters nodes and edges by source", () => {
    const webSnapshot = filterDeepSearchSnapshotBySource(createSnapshot(), "web");

    expect(webSnapshot.nodes.map((node) => node.id)).toEqual(["root", "web"]);
    expect(webSnapshot.edges.map((edge) => edge.id)).toEqual(["root-web"]);
  });

  test("opens web and local nodes through the resolved actions", () => {
    const snapshot = createSnapshot();
    const onOpenUrl = vi.fn();
    const onOpenLocalPath = vi.fn();
    const onRevealLocalPath = vi.fn();

    openDeepSearchNode(snapshot.nodes[1] ?? null, "open_file", {
      onOpenUrl,
      onOpenLocalPath,
      onRevealLocalPath
    });
    openDeepSearchNode(snapshot.nodes[2] ?? null, "reveal_in_manager", {
      onOpenUrl,
      onOpenLocalPath,
      onRevealLocalPath
    });
    revealDeepSearchNode(snapshot.nodes[2] ?? null, "reveal_in_manager", {
      onOpenUrl,
      onOpenLocalPath,
      onRevealLocalPath
    });

    expect(onOpenUrl).toHaveBeenCalledWith("https://lyra.test", "Lyra Web");
    expect(onRevealLocalPath).toHaveBeenCalledWith("/tmp/lyra.md");
    expect(onOpenLocalPath).toHaveBeenCalledWith("/tmp/lyra.md");
  });
});
