import { describe, expect, test, vi } from "vitest";

import { createBrowserAxController } from "../view-manager-runtime/ax-controller";
import { createBrowserAxSnapshotStore } from "../view-manager-runtime/ax-snapshot-store";
import type {
  WorkbenchBrowserAgentModeInfo,
  WorkbenchBrowserOsAxAdapter,
  WorkbenchBrowserSemanticFrame
} from "../types";
import type {
  BrowserAgentPageTarget,
  BrowserAgentSemanticFrameGraph
} from "../view-manager-runtime/types";

const browserMode: WorkbenchBrowserAgentModeInfo = {
  targetMode: "live",
  visibleFollow: false,
  authState: "liveProfile",
  reason: "default_current_visible_browser",
  profilePartition: "persist:lyra-live"
};

const mainFrame: WorkbenchBrowserSemanticFrame = {
  frameRef: "lumen-frame:main",
  frameTreeNodeId: 1,
  isMainFrame: true,
  url: "https://accounts.google.com/gsi/iframe/select",
  origin: "https://accounts.google.com",
  name: "",
  bounds: { x: 0, y: 0, width: 1280, height: 720 },
  domAccess: "cdp",
  accessibilityStatus: "available"
};

const frameGraph: BrowserAgentSemanticFrameGraph = {
  frames: [mainFrame],
  framesByTreeNodeId: new Map([[1, mainFrame]]),
  warnings: [],
  blockedRegions: []
};

type SendCommand = (
  method: string,
  params?: Record<string, unknown>,
  sessionId?: string
) => Promise<Record<string, unknown>>;

const createDeps = (options: {
  readonly sendCommand: SendCommand;
  readonly sendAgentInputEvent?: ReturnType<typeof vi.fn>;
  readonly address?: string;
  readonly isLoading?: boolean;
  readonly frameGraphOverride?: BrowserAgentSemanticFrameGraph;
  readonly assertSharedControlCanContinue?: ReturnType<typeof vi.fn>;
  readonly osAxAdapter?: WorkbenchBrowserOsAxAdapter;
}) => {
  const sendAgentInputEvent = options.sendAgentInputEvent ?? vi.fn();
  const assertSharedControlCanContinue = options.assertSharedControlCanContinue ?? vi.fn();
  const target = {
    tabId: "browser-tab-1",
    targetMode: "live",
    browserMode,
    address: options.address ?? "https://accounts.google.com/clientarea",
    title: "Client Area",
    isLoading: options.isLoading ?? false,
    webContents: {
      focus: vi.fn(),
      sendInputEvent: sendAgentInputEvent
    }
  } as unknown as BrowserAgentPageTarget;

  const session = {
    tabId: "browser-tab-1",
    sendCommand: vi.fn(options.sendCommand),
    subscribe: () => () => undefined,
    focus: vi.fn(),
    close: vi.fn(async () => undefined)
  };

  let epoch = 0;
  const axSnapshotStore = createBrowserAxSnapshotStore();
  const controller = createBrowserAxController({
    openDebuggerSessionForTarget: vi.fn(async () => session),
    resolveBrowserAgentTarget: vi.fn(async () => target),
    sendAgentInputEvent,
    publishBrowserAgentActivity: vi.fn(),
    recordFollowAction: vi.fn(),
    assertSharedControlCanContinue,
    buildSemanticFrameGraph: vi.fn(async () => options.frameGraphOverride ?? frameGraph),
    nextMapEpoch: () => (epoch += 1),
    axSnapshotStore,
    ...(options.osAxAdapter === undefined ? {} : { osAxAdapter: options.osAxAdapter })
  });
  return { controller, session, sendAgentInputEvent, assertSharedControlCanContinue, axSnapshotStore };
};

const googleButtonTree = {
  nodes: [
    {
      nodeId: "1",
      ignored: false,
      role: { value: "button" },
      name: { value: "Continue as Pete" },
      backendDOMNodeId: 42,
      properties: []
    }
  ]
};

const boxModel = { model: { border: [698, 296, 1058, 296, 1058, 332, 698, 332] } };

describe("browser_ax map", () => {
  test("returns the Google iframe button with a high-confidence oauth signal", async () => {
    const { controller } = createDeps({
      sendCommand: async (method) => {
        if (method === "Accessibility.getFullAXTree") return googleButtonTree;
        if (method === "DOM.getBoxModel") return boxModel;
        return {};
      }
    });

    const result = await controller.axMapAgentPage("browser-tab-1", { targetMode: "live", strategy: "interactive" });

    expect(result.ok).toBe(true);
    expect(result.nodes).toHaveLength(1);
    const node = result.nodes[0]!;
    expect(node.role).toBe("button");
    expect(node.name).toBe("Continue as Pete");
    expect(node.source).toBe("ax");
    expect(node.axRef.startsWith("ax:")).toBe(true);
    expect(node.bounds).toMatchObject({ x: 698, y: 296, width: 360, height: 36 });
    expect(node.provider).toBe("google");
    expect(result.authChallengeSignals?.[0]).toMatchObject({
      kind: "oauth_popup",
      confidence: "high",
      source: "ax",
      provider: "google"
    });
    expect(result.needsUserAction).toBeUndefined();
    expect(result.nextRecommendedAction).toBe("browser_ax.act");
  });

  test("empty AX tree on a cross-origin auth page recommends a visual fallback", async () => {
    const blockedFrame: WorkbenchBrowserSemanticFrame = {
      ...mainFrame,
      accessibilityStatus: "blocked"
    };
    const blockedGraph: BrowserAgentSemanticFrameGraph = {
      frames: [blockedFrame],
      framesByTreeNodeId: new Map([[1, blockedFrame]]),
      warnings: [],
      blockedRegions: [
        {
          id: "blocked-1",
          kind: "auth-prompt",
          fallback: "visual",
          confidence: "high",
          frameRef: "lumen-frame:main",
          frameTreeNodeId: 1,
          reason: "Cross-origin OAuth iframe"
        }
      ]
    };
    const { controller } = createDeps({
      frameGraphOverride: blockedGraph,
      sendCommand: async (method) => {
        if (method === "Accessibility.getFullAXTree") return { nodes: [] };
        return {};
      }
    });

    const result = await controller.axMapAgentPage("browser-tab-1", { targetMode: "live", strategy: "auth" });
    expect(result.nodes).toHaveLength(0);
    expect(result.nextRecommendedAction).toBe("lyra_lumen.see");
  });

  test("includeText controls document text nodes", async () => {
    const tree = {
      nodes: [
        { nodeId: "1", ignored: false, role: { value: "StaticText" }, name: { value: "Read me" }, properties: [] },
        { nodeId: "2", ignored: false, role: { value: "button" }, name: { value: "Save" }, properties: [] }
      ]
    };
    const { controller } = createDeps({
      address: "https://app.example.com/page",
      frameGraphOverride: {
        ...frameGraph,
        frames: [{ ...mainFrame, url: "https://app.example.com/page", origin: "https://app.example.com" }],
        framesByTreeNodeId: new Map([[1, { ...mainFrame, url: "https://app.example.com/page" }]])
      },
      sendCommand: async (method) => {
        if (method === "Accessibility.getFullAXTree") return tree;
        return {};
      }
    });

    const withoutText = await controller.axMapAgentPage("browser-tab-1", {
      targetMode: "live",
      strategy: "document"
    });
    expect(withoutText.nodes.map((node) => node.name)).toEqual(["Save"]);

    const withText = await controller.axMapAgentPage("browser-tab-1", {
      targetMode: "live",
      strategy: "document",
      includeText: true
    });
    expect(withText.nodes.map((node) => node.name)).toContain("Read me");
  });

  test("merges exact OOPIF AX targets with frame-offset bounds", async () => {
    const childFrame: WorkbenchBrowserSemanticFrame = {
      ...mainFrame,
      frameRef: "lumen-frame:child",
      frameTreeNodeId: 2,
      isMainFrame: false,
      url: "https://accounts.google.com/gsi/iframe/select",
      origin: "https://accounts.google.com",
      bounds: { x: 100, y: 80, width: 380, height: 180 },
      domAccess: "cdp"
    };
    const { controller } = createDeps({
      frameGraphOverride: {
        frames: [{ ...mainFrame, url: "https://app.example.com", origin: "https://app.example.com" }, childFrame],
        framesByTreeNodeId: new Map([[1, mainFrame], [2, childFrame]]),
        warnings: [],
        blockedRegions: []
      },
      sendCommand: async (method, _params, sessionId) => {
        if (method === "Accessibility.getFullAXTree" && sessionId === "child-session") {
          return googleButtonTree;
        }
        if (method === "Accessibility.getFullAXTree") return { nodes: [] };
        if (method === "Target.getTargets") {
          return {
            targetInfos: [{ type: "iframe", targetId: "target-child", url: childFrame.url }]
          };
        }
        if (method === "Target.attachToTarget") return { sessionId: "child-session" };
        if (method === "DOM.getBoxModel") {
          return { model: { border: [10, 20, 370, 20, 370, 56, 10, 56] } };
        }
        return {};
      }
    });

    const result = await controller.axMapAgentPage("browser-tab-1", {
      targetMode: "live",
      strategy: "interactive"
    });
    expect(result.nodes[0]?.bounds).toMatchObject({ x: 110, y: 100, width: 360, height: 36 });
  });

  test("does not return clickable OOPIF bounds when frame correlation is ambiguous", async () => {
    const firstFrame: WorkbenchBrowserSemanticFrame = {
      ...mainFrame,
      frameRef: "lumen-frame:child-1",
      frameTreeNodeId: 2,
      isMainFrame: false,
      url: "https://accounts.google.com/a",
      bounds: { x: 100, y: 80, width: 380, height: 180 },
      domAccess: "cdp"
    };
    const secondFrame: WorkbenchBrowserSemanticFrame = {
      ...firstFrame,
      frameRef: "lumen-frame:child-2",
      frameTreeNodeId: 3,
      url: "https://accounts.google.com/b",
      bounds: { x: 540, y: 80, width: 380, height: 180 }
    };
    const { controller } = createDeps({
      frameGraphOverride: {
        frames: [{ ...mainFrame, url: "https://app.example.com", origin: "https://app.example.com" }, firstFrame, secondFrame],
        framesByTreeNodeId: new Map([[1, mainFrame], [2, firstFrame], [3, secondFrame]]),
        warnings: [],
        blockedRegions: []
      },
      sendCommand: async (method, _params, sessionId) => {
        if (method === "Accessibility.getFullAXTree" && sessionId === "child-session") {
          return googleButtonTree;
        }
        if (method === "Accessibility.getFullAXTree") return { nodes: [] };
        if (method === "Target.getTargets") {
          return {
            targetInfos: [{ type: "iframe", targetId: "target-child", url: "https://accounts.google.com/common" }]
          };
        }
        if (method === "Target.attachToTarget") return { sessionId: "child-session" };
        if (method === "DOM.getBoxModel") return boxModel;
        return {};
      }
    });

    const result = await controller.axMapAgentPage("browser-tab-1", {
      targetMode: "live",
      strategy: "interactive"
    });
    expect(result.nodes).toHaveLength(0);
  });

  test("merges OS AX nodes with screen bounds and status", async () => {
    const osAxAdapter: WorkbenchBrowserOsAxAdapter = {
      loadedFrom: "/tmp/lyra_accessibility_napi.node",
      readTree: () => ({
        ok: true,
        status: { ok: true, platform: "macos", state: "available", nodeCount: 1 },
        nodes: [
          {
            osPath: "0/1",
            role: "button",
            name: "System Continue",
            screenBounds: { x: 700, y: 300, width: 120, height: 32 }
          }
        ]
      }),
      actOnNode: vi.fn()
    };
    const { controller } = createDeps({
      osAxAdapter,
      sendCommand: async (method) => {
        if (method === "Accessibility.getFullAXTree") return { nodes: [] };
        return {};
      }
    });

    const result = await controller.axMapAgentPage("browser-tab-1", { targetMode: "live" });
    expect(result.sources).toEqual(["cdp", "os"]);
    expect(result.osAxStatus?.state).toBe("available");
    expect(result.nodes[0]).toMatchObject({
      axSource: "os",
      coordinateSpace: "screen",
      screenBounds: { x: 700, y: 300, width: 120, height: 32 }
    });
    expect(result.nodes[0]?.bounds).toBeUndefined();
  });
});

describe("browser_ax act", () => {
  test("a non-sensitive button is clicked at its bounds center", async () => {
    const plainTree = {
      nodes: [
        {
          nodeId: "1",
          ignored: false,
          role: { value: "button" },
          name: { value: "Save" },
          backendDOMNodeId: 50,
          properties: []
        }
      ]
    };
    const sendAgentInputEvent = vi.fn();
    const { controller } = createDeps({
      address: "https://app.example.com/page",
      sendAgentInputEvent,
      frameGraphOverride: {
        ...frameGraph,
        frames: [{ ...mainFrame, url: "https://app.example.com/page", origin: "https://app.example.com" }],
        framesByTreeNodeId: new Map([[1, { ...mainFrame, url: "https://app.example.com/page" }]])
      },
      sendCommand: async (method) => {
        if (method === "Accessibility.getFullAXTree") return plainTree;
        if (method === "DOM.getBoxModel") return boxModel;
        // DOM.resolveNode returns no object => Tier 1 fails, Tier 2 pointer click runs.
        return {};
      }
    });

    const map = await controller.axMapAgentPage("browser-tab-1", { targetMode: "live", strategy: "interactive" });
    const axRef = map.nodes[0]!.axRef;
    sendAgentInputEvent.mockClear();

    const result = await controller.axActOnNode("browser-tab-1", { axRef, interaction: "click" });
    expect(result.ok).toBe(true);
    expect(result.method).toBe("cdpInput");
    expect(result.x).toBe(878);
    expect(result.y).toBe(314);
    const downEvent = sendAgentInputEvent.mock.calls.find((call) => call[1]?.type === "mouseDown");
    expect(downEvent?.[1]).toMatchObject({ x: 878, y: 314 });
  });

  test("an OAuth provider node is blocked with needsUserAction instead of clicking", async () => {
    const sendAgentInputEvent = vi.fn();
    const { controller } = createDeps({
      sendAgentInputEvent,
      sendCommand: async (method) => {
        if (method === "Accessibility.getFullAXTree") return googleButtonTree;
        if (method === "DOM.getBoxModel") return boxModel;
        return {};
      }
    });

    const map = await controller.axMapAgentPage("browser-tab-1", { targetMode: "live", strategy: "interactive" });
    const axRef = map.nodes[0]!.axRef;
    sendAgentInputEvent.mockClear();

    const result = await controller.axActOnNode("browser-tab-1", { axRef, interaction: "click" });
    expect(result.ok).toBe(false);
    expect(result.needsUserAction?.kind).toBe("auth_challenge");
    expect(result.needsUserAction?.provider).toBe("google");
    expect(result.nextRecommendedAction).toBe("lyra_lumen.elevate");
    expect(sendAgentInputEvent).not.toHaveBeenCalled();
  });

  test("a plain Continue button on a normal page is not blocked as high risk", async () => {
    const sendAgentInputEvent = vi.fn();
    const continueTree = {
      nodes: [
        {
          nodeId: "1",
          ignored: false,
          role: { value: "button" },
          name: { value: "Continue" },
          backendDOMNodeId: 51,
          properties: []
        }
      ]
    };
    const { controller } = createDeps({
      address: "https://app.example.com/wizard",
      sendAgentInputEvent,
      frameGraphOverride: {
        ...frameGraph,
        frames: [{ ...mainFrame, url: "https://app.example.com/wizard", origin: "https://app.example.com" }],
        framesByTreeNodeId: new Map([[1, { ...mainFrame, url: "https://app.example.com/wizard" }]])
      },
      sendCommand: async (method) => {
        if (method === "Accessibility.getFullAXTree") return continueTree;
        if (method === "DOM.getBoxModel") return boxModel;
        return {};
      }
    });

    const map = await controller.axMapAgentPage("browser-tab-1", { targetMode: "live", strategy: "interactive" });
    const result = await controller.axActOnNode("browser-tab-1", {
      axRef: map.nodes[0]!.axRef,
      interaction: "click"
    });

    expect(result.ok).toBe(true);
    expect(result.needsUserAction).toBeUndefined();
    expect(result.nextRecommendedAction).toBe("browser_ax.query");
  });

  test("an authorized OAuth provider node uses trusted pointer input instead of JS click", async () => {
    const sendAgentInputEvent = vi.fn();
    const methods: string[] = [];
    let axTreeReads = 0;
    const { controller } = createDeps({
      sendAgentInputEvent,
      sendCommand: async (method) => {
        methods.push(method);
        if (method === "Accessibility.getFullAXTree") {
          axTreeReads += 1;
          return axTreeReads === 1 ? googleButtonTree : { nodes: [] };
        }
        if (method === "DOM.getBoxModel") return boxModel;
        return {};
      }
    });

    const map = await controller.axMapAgentPage("browser-tab-1", { targetMode: "live", strategy: "interactive" });
    const axRef = map.nodes[0]!.axRef;
    methods.length = 0;
    sendAgentInputEvent.mockClear();

    const result = await controller.axActOnNode("browser-tab-1", {
      axRef,
      interaction: "click",
      authorized: true
    });

    expect(result.ok).toBe(true);
    expect(result.method).toBe("cdpInput");
    expect(result.x).toBe(878);
    expect(result.y).toBe(314);
    expect(methods).not.toContain("DOM.resolveNode");
    const downEvent = sendAgentInputEvent.mock.calls.find((call) => call[1]?.type === "mouseDown");
    expect(downEvent?.[1]).toMatchObject({ x: 878, y: 314 });
  });

  test("an authorized OAuth provider node reports failure when the prompt remains visible", async () => {
    const sendAgentInputEvent = vi.fn();
    const { controller } = createDeps({
      sendAgentInputEvent,
      sendCommand: async (method) => {
        if (method === "Accessibility.getFullAXTree") return googleButtonTree;
        if (method === "DOM.getBoxModel") return boxModel;
        return {};
      }
    });

    const map = await controller.axMapAgentPage("browser-tab-1", { targetMode: "live", strategy: "interactive" });
    const result = await controller.axActOnNode("browser-tab-1", {
      axRef: map.nodes[0]!.axRef,
      interaction: "click",
      authorized: true
    });

    expect(result.ok).toBe(false);
    expect(result.method).toBe("cdpInput");
    expect(result.error?.kind).toBe("axActionNotVerified");
    expect(result.nextRecommendedAction).toBe("browser_ax.query");
  });

  test("an authorized OAuth provider node without bounds refuses DOM click fallback", async () => {
    const sendAgentInputEvent = vi.fn();
    const methods: string[] = [];
    const { controller } = createDeps({
      sendAgentInputEvent,
      sendCommand: async (method) => {
        methods.push(method);
        if (method === "Accessibility.getFullAXTree") return googleButtonTree;
        return {};
      }
    });

    const map = await controller.axMapAgentPage("browser-tab-1", { targetMode: "live", strategy: "interactive" });
    const axRef = map.nodes[0]!.axRef;
    methods.length = 0;

    const result = await controller.axActOnNode("browser-tab-1", {
      axRef,
      interaction: "click",
      authorized: true
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe("trustedAxInputUnavailable");
    expect(result.nextRecommendedAction).toBe("lyra_lumen.see");
    expect(methods).not.toContain("DOM.resolveNode");
    expect(sendAgentInputEvent).not.toHaveBeenCalled();
  });

  test("a stale axRef is rejected after the snapshot is invalidated", async () => {
    const { controller, axSnapshotStore } = createDeps({
      address: "https://app.example.com/page",
      frameGraphOverride: {
        ...frameGraph,
        frames: [{ ...mainFrame, url: "https://app.example.com/page", origin: "https://app.example.com" }],
        framesByTreeNodeId: new Map([[1, { ...mainFrame, url: "https://app.example.com/page" }]])
      },
      sendCommand: async (method) => {
        if (method === "Accessibility.getFullAXTree") {
          return {
            nodes: [
              {
                nodeId: "1",
                ignored: false,
                role: { value: "button" },
                name: { value: "Save" },
                backendDOMNodeId: 50,
                properties: []
              }
            ]
          };
        }
        if (method === "DOM.getBoxModel") return boxModel;
        return {};
      }
    });
    const map = await controller.axMapAgentPage("browser-tab-1", { targetMode: "live", strategy: "interactive" });
    const axRef = map.nodes[0]!.axRef;
    axSnapshotStore.invalidate("browser-tab-1", "live", "navigation");

    const result = await controller.axActOnNode("browser-tab-1", { axRef, interaction: "click" });
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe("staleAxRef");
    expect(result.nextRecommendedAction).toBe("browser_ax.map");
  });

  test("full verification returns a follow-up AX snapshot id", async () => {
    const sendAgentInputEvent = vi.fn();
    const { controller } = createDeps({
      address: "https://app.example.com/page",
      sendAgentInputEvent,
      frameGraphOverride: {
        ...frameGraph,
        frames: [{ ...mainFrame, url: "https://app.example.com/page", origin: "https://app.example.com" }],
        framesByTreeNodeId: new Map([[1, { ...mainFrame, url: "https://app.example.com/page" }]])
      },
      sendCommand: async (method) => {
        if (method === "Accessibility.getFullAXTree") {
          return {
            nodes: [
              {
                nodeId: "1",
                ignored: false,
                role: { value: "button" },
                name: { value: "Save" },
                backendDOMNodeId: 50,
                properties: []
              }
            ]
          };
        }
        if (method === "DOM.getBoxModel") return boxModel;
        return {};
      }
    });
    const map = await controller.axMapAgentPage("browser-tab-1", { targetMode: "live", strategy: "interactive" });
    const result = await controller.axActOnNode("browser-tab-1", {
      axRef: map.nodes[0]!.axRef,
      interaction: "click",
      verification: "full"
    });
    expect(result.ok).toBe(true);
    expect(result.afterObservationId).toMatch(/^ax-snap-/);
  });

  test("acts on OS AX nodes through the OS adapter", async () => {
    const actOnNode = vi.fn(async () => ({ ok: true }));
    const osAxAdapter: WorkbenchBrowserOsAxAdapter = {
      readTree: () => ({
        ok: true,
        status: { ok: true, platform: "macos", state: "available", nodeCount: 1 },
        nodes: [
          {
            osPath: "0/1",
            role: "button",
            name: "System Save",
            screenBounds: { x: 700, y: 300, width: 120, height: 32 }
          }
        ]
      }),
      actOnNode
    };
    const { controller } = createDeps({
      osAxAdapter,
      sendCommand: async (method) => {
        if (method === "Accessibility.getFullAXTree") return { nodes: [] };
        return {};
      }
    });
    const map = await controller.axMapAgentPage("browser-tab-1", { targetMode: "live" });
    const result = await controller.axActOnNode("browser-tab-1", {
      axRef: map.nodes[0]!.axRef,
      interaction: "click"
    });
    expect(result.ok).toBe(true);
    expect(result.method).toBe("osAx");
    expect(actOnNode).toHaveBeenCalledWith({ osPath: "0/1", interaction: "click" });
  });
});

describe("browser_ax explain", () => {
  test("explains a Google node as an authorization boundary", async () => {
    const { controller } = createDeps({
      sendCommand: async (method) => {
        if (method === "Accessibility.getFullAXTree") return googleButtonTree;
        if (method === "DOM.getBoxModel") return boxModel;
        return {};
      }
    });
    const map = await controller.axMapAgentPage("browser-tab-1", { targetMode: "live", strategy: "interactive" });
    const explanation = controller.axExplainNode("browser-tab-1", { axRef: map.nodes[0]!.axRef });
    expect(explanation.axAvailable).toBe(true);
    expect(explanation.domAvailable).toBe(true);
    expect(explanation.userActionRequired).toBe(true);
    expect(explanation.provider).toBe("google");
  });
});
