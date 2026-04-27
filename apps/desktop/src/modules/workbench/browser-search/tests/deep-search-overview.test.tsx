import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { SearchDeepSnapshot } from "../../../../shared/desktop-bridge";
import { DeepSearchOverview, type DeepSearchOverviewLabels } from "../deep-search-overview";

const labelKeys = [
  "overviewLabel",
  "selectedNodeLabel",
  "phaseLabel",
  "budgetLabel",
  "webStatusLabel",
  "localStatusLabel",
  "dedupedLabel",
  "derivedLabel",
  "roundsLabel",
  "sourceFilterLabel",
  "webLabel",
  "localLabel",
  "openLabel",
  "expandLabel",
  "centerLabel",
  "emptySelectionLabel",
  "snippetLabel",
  "sourceLabel",
  "connectedLinksLabel",
  "edgeFiltersLabel",
  "directionLabel",
  "incomingLabel",
  "outgoingLabel",
  "bothLabel",
  "discoveredLabel",
  "expandedLabel",
  "relatedLabel",
  "hostsSubdomainLabel",
  "containsPageLabel",
  "lineageLabel",
  "alternateLinksLabel",
  "revealInManagerLabel",
  "matchKindLabel",
  "lineLabel",
  "sharedTermsLabel",
  "domainLabel",
  "subdomainLabel",
  "pageLabel",
  "verifiedLabel",
  "guessedLabel",
  "discoveredByLabel",
  "verificationScoreLabel",
  "guessedDomainsLabel",
  "verifiedDomainsLabel",
  "subdomainsLabel",
  "visitedPagesLabel",
  "queuedPagesLabel",
  "droppedPagesLabel",
  "siteExpansionStatusLabel",
  "allLabel"
] as const satisfies readonly (keyof DeepSearchOverviewLabels)[];

const labels = Object.fromEntries(
  labelKeys.map((key) => [key, key])
) as DeepSearchOverviewLabels;

const snapshot: SearchDeepSnapshot = {
  query: "lyra",
  budgetPreset: "medium",
  phase: "completed",
  nodes: [
    { id: "root", kind: "root_query", title: "lyra", status: "ready" }
  ],
  edges: [],
  web: {
    status: "ready",
    engineBuckets: [],
    blendedCount: 0
  },
  local: {
    status: "ready",
    scopePreset: "home",
    roots: [],
    elapsedMs: 0,
    stats: {
      scannedFiles: 0,
      scannedDirs: 0,
      contentScannedFiles: 0,
      matchedFiles: 0,
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
};

describe("DeepSearchOverview", () => {
  test("renders source filters, metrics, and selected-node sections", () => {
    render(
      <DeepSearchOverview
        labels={labels}
        snapshot={snapshot}
        selectedNode={null}
        connectedEdges={[]}
        lineage={{ nodes: [], alternateCount: 0 }}
        sourceFilter="all"
        edgeKindFilter="all"
        edgeDirectionFilter="both"
        localPrimaryAction="open_file"
        onOpenSelected={vi.fn()}
        onRevealSelected={vi.fn()}
        onExpandSelected={vi.fn()}
        onCenterSelected={vi.fn()}
        onSourceFilterChange={vi.fn()}
        onEdgeKindFilterChange={vi.fn()}
        onEdgeDirectionFilterChange={vi.fn()}
        onHighlightEdge={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "sourceFilterLabel" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "overviewLabel" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "selectedNodeLabel" })).toBeInTheDocument();
    expect(screen.getByText("emptySelectionLabel")).toBeInTheDocument();
  });
});
