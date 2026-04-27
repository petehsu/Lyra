import { describe, expect, test } from "vitest";

import type { SearchDeepEdge, SearchDeepNode } from "../../../../shared/desktop-bridge";
import {
  formatDeepSearchEdgeReason,
  renderNodeMeta,
  renderSnippet,
  resolveDeepSearchPrimaryActionLabel,
  resolveDeepSearchSecondaryActionLabel,
  type DeepSearchOverviewLabels
} from "../deep-search-overview-model";

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

describe("deep search overview model", () => {
  test("formats edge reasons from metadata", () => {
    const edge: SearchDeepEdge = {
      id: "edge-1",
      sourceId: "root",
      targetId: "local",
      kind: "discovered_from",
      reasonCode: "local_match",
      metadata: {
        matchKind: "content",
        line: 42
      }
    };

    expect(formatDeepSearchEdgeReason(edge, labels)).toBe("matchKindLabel: content \u00B7 lineLabel 42");
  });

  test("resolves node metadata and snippets without rendering", () => {
    const node: SearchDeepNode = {
      id: "local-1",
      kind: "local_result",
      title: "notes.md",
      status: "ready",
      metadata: {
        path: "/tmp/notes.md",
        snippet: "Matched snippet"
      }
    };

    expect(renderNodeMeta(node)).toBe("/tmp/notes.md");
    expect(renderSnippet(labels, node)).toBe("Matched snippet");
  });

  test("uses reveal as the primary local action only when requested", () => {
    const node: SearchDeepNode = {
      id: "local-1",
      kind: "local_result",
      title: "notes.md",
      status: "ready"
    };

    expect(resolveDeepSearchPrimaryActionLabel(labels, node, "reveal_in_manager")).toBe("revealInManagerLabel");
    expect(resolveDeepSearchSecondaryActionLabel(labels, node, "reveal_in_manager")).toBe("openLabel");
  });
});
