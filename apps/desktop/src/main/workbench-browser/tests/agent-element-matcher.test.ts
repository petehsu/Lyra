import { describe, expect, test } from "vitest";

import type { WorkbenchBrowserAgentElement } from "../types";
import {
  buildStableElementFingerprint,
  buildWorkflowElementIdentity,
  matchElementIdentity
} from "../view-manager-runtime/agent-element-matcher";

const baseElement = (
  overrides: Partial<WorkbenchBrowserAgentElement> = {}
): WorkbenchBrowserAgentElement => ({
  id: 1,
  targetRef: "lumen:abc",
  stableId: "abc",
  target: {
    targetRef: "lumen:abc",
    targetKind: "button",
    frameRef: "lumen-frame:1",
    frameChain: ["lumen-frame:1"],
    elementFingerprint: "fp",
    mapEpoch: 1,
    expiresAt: Date.now() + 60_000
  },
  frameRef: "lumen-frame:1",
  elementFingerprint: "fp-old",
  frameTreeNodeId: 1,
  tagName: "button",
  role: "button",
  label: "Sign in",
  selectorPreview: "button#submit.btn-active",
  bounds: { x: 10, y: 20, width: 100, height: 40 },
  focusable: true,
  disabled: false,
  editable: false,
  ...overrides
});

describe("agent-element-matcher", () => {
  test("stable fingerprint ignores dynamic classes and bounds", () => {
    const pageUrl = "https://example.test/login";
    const withDynamic = buildStableElementFingerprint(pageUrl, baseElement({
      selectorPreview: "button#submit.btn-active.btn-hover",
      bounds: { x: 99, y: 88, width: 200, height: 80 }
    }));
    const stable = buildStableElementFingerprint(pageUrl, baseElement({
      selectorPreview: "button#submit",
      bounds: { x: 0, y: 0, width: 10, height: 10 }
    }));
    expect(withDynamic).toBe(stable);
  });

  test("matchElementIdentity prefers exact then stable then axName", () => {
    const pageUrl = "https://example.test/app";
    const snapshot = buildWorkflowElementIdentity(pageUrl, baseElement({
      elementFingerprint: "fp-exact",
      label: "New Contact",
      role: "menuitem",
      selectorPreview: "div[role=menuitem]"
    }));

    const exact = baseElement({
      targetRef: "lumen:exact",
      elementFingerprint: "fp-exact",
      label: "Other",
      role: "menuitem"
    });
    expect(matchElementIdentity(pageUrl, snapshot, [exact])?.matchLevel).toBe("exact");

    const stable = baseElement({
      targetRef: "lumen:stable",
      elementFingerprint: "fp-other",
      label: "New Contact",
      role: "menuitem",
      selectorPreview: "div[role=menuitem].item-selected"
    });
    const stableFp = buildStableElementFingerprint(pageUrl, stable);
    const snapshotStable = {
      ...snapshot,
      elementFingerprint: "fp-stale",
      stableFingerprint: stableFp
    };
    expect(
      matchElementIdentity(pageUrl, snapshotStable, [stable])?.matchLevel
    ).toBe("stable");

    const axName = baseElement({
      targetRef: "lumen:ax",
      elementFingerprint: "fp-random",
      label: "New Contact",
      role: "menuitem",
      frameRef: snapshot.frameRef,
      selectorPreview: "div.dynamic"
    });
    const axSnapshot = {
      ...snapshot,
      elementFingerprint: "fp-stale-2",
      stableFingerprint: "fp-stable-miss"
    };
    expect(
      matchElementIdentity(pageUrl, axSnapshot, [axName])?.matchLevel
    ).toBe("axName");
  });

  test("matchElementIdentity prefers xpath after stable fingerprint miss", () => {
    const pageUrl = "https://example.test/menu";
    const xpath = "/html/body/div[2]/button[1]";
    const snapshot = buildWorkflowElementIdentity(pageUrl, baseElement({
      elementFingerprint: "fp-stale",
      label: "Settings",
      role: "menuitem",
      selectorPreview: "div.item-selected",
      xpath
    }));
    const candidate = baseElement({
      targetRef: "lumen:xpath-hit",
      elementFingerprint: "fp-other",
      label: "Different label",
      role: "menuitem",
      selectorPreview: "div.item",
      xpath
    });
    expect(
      matchElementIdentity(pageUrl, {
        ...snapshot,
        stableFingerprint: "miss"
      }, [candidate])?.matchLevel
    ).toBe("xpath");
  });

  test("matchElementIdentity resolves attribute selectors", () => {
    const pageUrl = "https://example.test/form";
    const snapshot = buildWorkflowElementIdentity(pageUrl, baseElement({
      label: "",
      role: "textbox",
      tagName: "input",
      selectorPreview: 'input[name="email"]'
    }));
    const candidate = baseElement({
      targetRef: "lumen:email",
      tagName: "input",
      role: "textbox",
      label: "Email",
      selectorPreview: 'input[name="email"]',
      elementFingerprint: "different"
    });
    expect(
      matchElementIdentity(pageUrl, {
        ...snapshot,
        stableFingerprint: "miss"
      }, [candidate])?.matchLevel
    ).toBe("attribute");
  });
});