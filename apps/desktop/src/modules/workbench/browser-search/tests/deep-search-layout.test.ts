import { describe, expect, test } from "vitest";

import type { SearchDeepSnapshot } from "../../../../shared/desktop-bridge";
import { buildDeepSearchCanvasNodes } from "../deep-search-layout";

const createSnapshot = (): SearchDeepSnapshot => ({
  query: "openai",
  budgetPreset: "medium",
  phase: "streaming",
  nodes: [
    { id: "root", kind: "root_query", title: "openai", status: "ready", metadata: { query: "openai" } },
    { id: "domain-1", kind: "site_domain", title: "openai.com", status: "ready", score: 99 },
    { id: "domain-2", kind: "site_domain", title: "platform.openai.com", status: "ready", score: 96 },
    { id: "domain-3", kind: "site_domain", title: "help.openai.com", status: "ready", score: 94 },
    { id: "domain-4", kind: "site_domain", title: "chatgpt.com", status: "ready", score: 92 },
    { id: "derived-1", kind: "derived_query", title: "openai docs", status: "ready", score: 88, metadata: { query: "openai docs" } },
    { id: "derived-2", kind: "derived_query", title: "openai login", status: "ready", score: 86, metadata: { query: "openai login" } },
    { id: "derived-3", kind: "derived_query", title: "openai api", status: "ready", score: 84, metadata: { query: "openai api" } },
    { id: "local-1", kind: "local_result", title: "openai-notes.md", status: "ready", score: 72 },
    { id: "local-2", kind: "local_result", title: "openai-sdk.ts", status: "ready", score: 71 },
    { id: "sub-1", kind: "site_subdomain", title: "docs.openai.com", status: "ready", score: 90 },
    { id: "sub-2", kind: "site_subdomain", title: "auth.openai.com", status: "ready", score: 89 },
    { id: "sub-3", kind: "site_subdomain", title: "status.openai.com", status: "ready", score: 87 },
    { id: "page-1", kind: "web_page", title: "API Reference", status: "ready", score: 83 },
    { id: "page-2", kind: "web_page", title: "Quickstart", status: "ready", score: 82 },
    { id: "page-3", kind: "web_page", title: "Sign in", status: "ready", score: 81 },
    { id: "page-4", kind: "web_page", title: "Status", status: "ready", score: 80 },
    { id: "page-5", kind: "web_page", title: "Pricing", status: "ready", score: 79 },
    { id: "page-6", kind: "web_page", title: "Download", status: "ready", score: 78 }
  ],
  edges: [
    { id: "e-root-domain-1", sourceId: "root", targetId: "domain-1", kind: "discovered_from" },
    { id: "e-root-domain-2", sourceId: "root", targetId: "domain-2", kind: "discovered_from" },
    { id: "e-root-domain-3", sourceId: "root", targetId: "domain-3", kind: "discovered_from" },
    { id: "e-root-domain-4", sourceId: "root", targetId: "domain-4", kind: "discovered_from" },
    { id: "e-root-derived-1", sourceId: "root", targetId: "derived-1", kind: "expanded_to" },
    { id: "e-root-derived-2", sourceId: "root", targetId: "derived-2", kind: "expanded_to" },
    { id: "e-root-derived-3", sourceId: "root", targetId: "derived-3", kind: "expanded_to" },
    { id: "e-root-local-1", sourceId: "root", targetId: "local-1", kind: "discovered_from" },
    { id: "e-root-local-2", sourceId: "root", targetId: "local-2", kind: "discovered_from" },
    { id: "e-domain-1-sub-1", sourceId: "domain-1", targetId: "sub-1", kind: "hosts_subdomain" },
    { id: "e-domain-1-page-5", sourceId: "domain-1", targetId: "page-5", kind: "contains_page" },
    { id: "e-domain-2-sub-2", sourceId: "domain-2", targetId: "sub-2", kind: "hosts_subdomain" },
    { id: "e-domain-3-sub-3", sourceId: "domain-3", targetId: "sub-3", kind: "hosts_subdomain" },
    { id: "e-sub-1-page-1", sourceId: "sub-1", targetId: "page-1", kind: "contains_page" },
    { id: "e-sub-1-page-2", sourceId: "sub-1", targetId: "page-2", kind: "contains_page" },
    { id: "e-sub-2-page-3", sourceId: "sub-2", targetId: "page-3", kind: "contains_page" },
    { id: "e-sub-3-page-4", sourceId: "sub-3", targetId: "page-4", kind: "contains_page" },
    { id: "e-derived-3-page-6", sourceId: "derived-3", targetId: "page-6", kind: "contains_page" }
  ],
  web: {
    status: "ready",
    engineBuckets: [],
    blendedCount: 12,
    siteExpansion: {
      status: "ready",
      domainCandidates: 6,
      verifiedDomains: 4,
      discoveredSubdomains: 3,
      visitedPages: 8,
      queuedPages: 0,
      droppedPages: 0,
      guessAttempts: 3
    }
  },
  local: {
    status: "ready",
    scopePreset: "home",
    roots: [],
    elapsedMs: 15,
    stats: {
      scannedFiles: 32,
      scannedDirs: 5,
      contentScannedFiles: 12,
      matchedFiles: 2,
      skippedUnreadable: 0,
      skippedBinaryOrTooLarge: 0,
      usedIndex: true
    }
  },
  stats: {
    dedupedResults: 4,
    derivedQueries: 3,
    expansionRounds: 1
  },
  lastUpdatedAt: "2026-04-09T00:00:00.000Z"
});

describe("deep search layout", () => {
  test("keeps automatically placed cards from overlapping", () => {
    const nodes = buildDeepSearchCanvasNodes(createSnapshot(), new Map(), () => ({}));

    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const left = nodes[leftIndex];
      if (left === undefined) {
        continue;
      }
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const right = nodes[rightIndex];
        if (right === undefined) {
          continue;
        }
        const leftCenterX = left.position.x + (left.width ?? 0) / 2;
        const leftCenterY = left.position.y + (left.height ?? 0) / 2;
        const rightCenterX = right.position.x + (right.width ?? 0) / 2;
        const rightCenterY = right.position.y + (right.height ?? 0) / 2;
        const overlapX = Math.abs(leftCenterX - rightCenterX) < ((left.width ?? 0) + (right.width ?? 0)) / 2;
        const overlapY = Math.abs(leftCenterY - rightCenterY) < ((left.height ?? 0) + (right.height ?? 0)) / 2;
        expect(overlapX && overlapY, `${left.id} overlaps ${right.id}`).toBe(false);
      }
    }
  });
});
