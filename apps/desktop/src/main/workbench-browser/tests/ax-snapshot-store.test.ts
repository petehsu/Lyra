import { describe, expect, test, vi, afterEach } from "vitest";

import type { BrowserAxNode, BrowserAxSnapshot } from "../types";
import {
  BROWSER_AX_SNAPSHOT_TTL_MS,
  createBrowserAxSnapshotStore
} from "../view-manager-runtime/ax-snapshot-store";
import {
  browserAxNodeHash,
  browserAxSnapshotHash,
  classifyRisk,
  detectProvider,
  roleToActionCapabilities
} from "../view-manager-runtime/ax-detectors";

const makeNode = (axRef: string, overrides: Partial<BrowserAxNode> = {}): BrowserAxNode => ({
  axRef,
  role: "button",
  name: "Continue",
  state: {},
  actionCapabilities: ["click", "focus"],
  confidence: 0.86,
  source: "ax",
  axSource: "cdp",
  coordinateSpace: "webContentsCss",
  ...overrides
});

const makeSnapshot = (
  overrides: Partial<BrowserAxSnapshot> & { readonly nodes?: readonly BrowserAxNode[] } = {}
): BrowserAxSnapshot => {
  const tabId = overrides.tabId ?? "browser-tab-1";
  const targetMode = overrides.targetMode ?? "live";
  const createdAt = overrides.createdAt ?? Date.now();
  const mapEpoch = overrides.mapEpoch ?? 1;
  const snapshotHash = overrides.snapshotHash ?? browserAxSnapshotHash(tabId, targetMode, createdAt, mapEpoch);
  const nodes = overrides.nodes ?? [makeNode(`ax:${snapshotHash}:node1`)];
  return {
    snapshotId: overrides.snapshotId ?? `ax-snap-${snapshotHash}`,
    snapshotHash,
    tabId,
    targetMode,
    url: overrides.url ?? "https://example.com",
    title: overrides.title ?? "Example",
    createdAt,
    mapEpoch,
    ttlMs: overrides.ttlMs ?? BROWSER_AX_SNAPSHOT_TTL_MS,
    nodesByAxRef: new Map(nodes.map((node) => [node.axRef, node])),
    cdpNodeIndex: new Map(nodes.map((node) => [node.axRef, {}]))
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("axRef hashing", () => {
  test("axRef format is ax:<snapshotHash>:<nodeHash>", () => {
    const snapshotHash = browserAxSnapshotHash("tab", "live", 1000, 2);
    const nodeHash = browserAxNodeHash({ backendDOMNodeId: 12, role: "button", name: "Continue" });
    const axRef = `ax:${snapshotHash}:${nodeHash}`;
    expect(axRef.split(":")).toHaveLength(3);
    expect(axRef.startsWith("ax:")).toBe(true);
  });

  test("snapshot hash is stable for identical inputs and varies by epoch", () => {
    expect(browserAxSnapshotHash("tab", "live", 1000, 1)).toBe(
      browserAxSnapshotHash("tab", "live", 1000, 1)
    );
    expect(browserAxSnapshotHash("tab", "live", 1000, 1)).not.toBe(
      browserAxSnapshotHash("tab", "live", 1000, 2)
    );
  });
});

describe("snapshot store", () => {
  test("remembers and resolves a node by axRef", () => {
    const store = createBrowserAxSnapshotStore();
    const snapshot = makeSnapshot();
    store.rememberSnapshot(snapshot);
    const axRef = [...snapshot.nodesByAxRef.keys()][0]!;
    const resolution = store.resolveAxRef(axRef);
    expect(resolution.kind).toBe("ok");
    if (resolution.kind === "ok") {
      expect(resolution.node.axRef).toBe(axRef);
    }
  });

  test("getLatest returns the most recent snapshot per tab/targetMode", () => {
    const store = createBrowserAxSnapshotStore();
    const now = Date.now();
    const first = makeSnapshot({ createdAt: now, mapEpoch: 1 });
    const second = makeSnapshot({ createdAt: now + 1, mapEpoch: 2 });
    store.rememberSnapshot(first);
    store.rememberSnapshot(second);
    expect(store.getLatest("browser-tab-1", "live")?.snapshotId).toBe(second.snapshotId);
  });

  test("malformed axRef resolves to stale missingSnapshot", () => {
    const store = createBrowserAxSnapshotStore();
    expect(store.resolveAxRef("lumen:abc").kind).toBe("stale");
    expect(store.resolveAxRef("ax:only-two").kind).toBe("stale");
  });

  test("unknown node within a live snapshot resolves to unknownNode", () => {
    const store = createBrowserAxSnapshotStore();
    const snapshot = makeSnapshot();
    store.rememberSnapshot(snapshot);
    const resolution = store.resolveAxRef(`ax:${snapshot.snapshotHash}:does-not-exist`);
    expect(resolution.kind).toBe("unknownNode");
  });

  test("TTL expiry makes the snapshot stale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const store = createBrowserAxSnapshotStore();
    const snapshot = makeSnapshot({ createdAt: 0, ttlMs: 1000 });
    store.rememberSnapshot(snapshot);
    const axRef = [...snapshot.nodesByAxRef.keys()][0]!;
    expect(store.resolveAxRef(axRef).kind).toBe("ok");
    vi.setSystemTime(2000);
    expect(store.resolveAxRef(axRef).kind).toBe("stale");
    expect(store.getLatest("browser-tab-1", "live")).toBeUndefined();
  });

  test("invalidate drops snapshots for the tab", () => {
    const store = createBrowserAxSnapshotStore();
    const snapshot = makeSnapshot();
    store.rememberSnapshot(snapshot);
    store.invalidate("browser-tab-1", "live", "navigation");
    const axRef = [...snapshot.nodesByAxRef.keys()][0]!;
    expect(store.resolveAxRef(axRef).kind).toBe("stale");
    expect(store.getLatest("browser-tab-1", "live")).toBeUndefined();
  });
});

describe("role -> action capabilities", () => {
  test("button maps to click+focus+press", () => {
    const caps = roleToActionCapabilities("button", {}, true);
    expect(caps).toContain("click");
    expect(caps).toContain("focus");
  });

  test("textbox maps to type/focus/press but not click without it being a button", () => {
    const caps = roleToActionCapabilities("textbox", {}, true);
    expect(caps).toContain("type");
    expect(caps).toContain("focus");
  });

  test("checkbox maps to toggle", () => {
    expect(roleToActionCapabilities("checkbox", {}, true)).toContain("toggle");
  });

  test("a node without bounds cannot be clicked", () => {
    expect(roleToActionCapabilities("button", {}, false)).not.toContain("click");
    expect(roleToActionCapabilities("button", {}, false)).toContain("focus");
  });

  test("disabled node drops click/type/toggle", () => {
    const caps = roleToActionCapabilities("button", { disabled: true }, true);
    expect(caps).not.toContain("click");
  });
});

describe("provider + risk detection", () => {
  test("google host is detected", () => {
    expect(detectProvider("https://accounts.google.com/gsi/iframe/select", "button", "Continue as Pete")).toBe("google");
  });

  test("provider host matching respects domain boundaries", () => {
    expect(detectProvider("https://accounts.google.com.evil.example/auth", "button", "Continue")).toBeUndefined();
    expect(detectProvider("https://checkout.paypal.com/checkout", "button", "Pay now")).toBe("paypal");
    expect(detectProvider("https://paypal.com.evil.example/checkout", "button", "Pay now")).toBeUndefined();
  });

  test("apple/microsoft hosts are detected", () => {
    expect(detectProvider("https://appleid.apple.com/auth", "button", "Continue")).toBe("apple");
    expect(detectProvider("https://login.microsoftonline.com/common", "button", "Sign in")).toBe("microsoft");
  });

  test("provider is not inferred from localized accessible names", () => {
    expect(detectProvider("https://example.com", "button", "Sign in with Google")).toBeUndefined();
    expect(detectProvider("https://example.com", "button", "使用 Google 登录")).toBeUndefined();
  });

  test("oauth provider nodes are classified high risk", () => {
    expect(
      classifyRisk(
        { role: "button", name: "Continue as Pete", provider: "google" },
        "authorize"
      ).highRisk
    ).toBe(true);
  });

  test("risk follows the structured effect across languages", () => {
    for (const name of ["Authorize payment", "授权付款", "支払いを承認", "결제 승인", "Autorizar pago"]) {
      expect(classifyRisk({ role: "button", name }, "purchase").highRisk).toBe(true);
    }
  });

  test("observable actions stay low risk regardless of localized labels", () => {
    expect(classifyRisk({ role: "button", name: "Authorize payment" }, "observe").highRisk).toBe(false);
    expect(classifyRisk({ role: "button", name: "授权" }, "observe").highRisk).toBe(false);
  });

  test("unknown effects fail closed", () => {
    expect(classifyRisk({ role: "button", name: "Save" }).highRisk).toBe(true);
  });

  test("a plain button is not high risk", () => {
    expect(classifyRisk({ role: "button", name: "Save" }, "editDraft").highRisk).toBe(false);
  });
});
