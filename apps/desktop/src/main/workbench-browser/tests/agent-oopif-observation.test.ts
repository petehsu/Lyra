import { describe, expect, test } from "vitest";
import {
  findOopifTargetForFrame,
  isKnownOAuthIframeHost,
  resolveCrossOriginBlockedFallback
} from "../view-manager-runtime/agent-oopif-observation";
import type { WorkbenchBrowserSemanticFrame } from "../types";
import type { BrowserAgentSemanticFrameGraph } from "../view-manager-runtime/types";

const mainFrame: WorkbenchBrowserSemanticFrame = {
  frameRef: "lumen-frame:main",
  frameTreeNodeId: 1,
  isMainFrame: true,
  url: "https://merchant.test/checkout",
  origin: "https://merchant.test",
  name: "",
  bounds: { x: 0, y: 0, width: 1280, height: 720 },
  domAccess: "direct",
  accessibilityStatus: "unknown"
};

const childFrame: WorkbenchBrowserSemanticFrame = {
  frameRef: "lumen-frame:child",
  frameTreeNodeId: 2,
  parentFrameRef: mainFrame.frameRef,
  parentFrameTreeNodeId: 1,
  isMainFrame: false,
  url: "https://pay.example/auth",
  origin: "https://pay.example",
  name: "pay",
  bounds: { x: 240, y: 140, width: 360, height: 220 },
  domAccess: "cdp",
  accessibilityStatus: "unknown"
};

const frameGraph: BrowserAgentSemanticFrameGraph = {
  frames: [mainFrame, childFrame],
  framesByTreeNodeId: new Map([[1, mainFrame], [2, childFrame]]),
  warnings: [],
  blockedRegions: []
};

describe("agent-oopif-observation", () => {
  test("resolves coordinate fallback for bounded cross-origin frames", () => {
    expect(resolveCrossOriginBlockedFallback(childFrame)).toBe("coordinate");
  });

  test("resolves ax fallback for known OAuth iframe hosts", () => {
    expect(
      resolveCrossOriginBlockedFallback({
        ...childFrame,
        url: "https://accounts.google.com/gsi/button"
      })
    ).toBe("ax");
    expect(isKnownOAuthIframeHost("https://login.microsoftonline.com/common/oauth2")).toBe(true);
  });

  test("finds OOPIF targets by exact URL and empty-url fallback", () => {
    const exact = findOopifTargetForFrame(childFrame, [
      { type: "page", targetId: "page-1", url: "https://merchant.test/checkout" },
      { type: "iframe", targetId: "oopif-1", url: "https://pay.example/auth" }
    ], frameGraph);
    expect(exact).toEqual({ targetId: "oopif-1", confidence: "high" });

    const emptyUrl = findOopifTargetForFrame(childFrame, [
      { type: "iframe", targetId: "oopif-lazy", url: "" }
    ], frameGraph);
    expect(emptyUrl).toEqual({ targetId: "oopif-lazy", confidence: "medium" });
  });
});