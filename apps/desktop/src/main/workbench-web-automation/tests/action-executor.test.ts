import { describe, expect, test, vi } from "vitest";

import { executeWebAction } from "../action-executor";
import type { WorkbenchBrowserIpcBridge } from "../../workbench-browser/service";
import type { WorkbenchWebGraphSnapshot } from "../types";

const graph: WorkbenchWebGraphSnapshot = {
  tabId: "browser-tab-1",
  graphId: "scan:test",
  builtAt: Date.now(),
  nodeCount: 1,
  edgeCount: 0,
  interactableCount: 1,
  truncated: false,
  budgetExhausted: false,
  nodes: [{
    nodeId: "node-1",
    frameTreeNodeId: 10,
    tagName: "textarea",
    role: "textbox",
    selectorAddress: {
      frameTreeNodeId: 10,
      path: "textarea.compose"
    },
    stableSignature: {
      tagName: "textarea",
      role: "textbox"
    },
    interactable: {
      clickable: false,
      typable: true,
      selectable: false,
      focusable: true,
      scrollable: false
    },
    visibilityState: "visible",
    bounds: {
      x: 1,
      y: 2,
      width: 300,
      height: 24
    }
  }],
  edges: []
};

const createBridge = (result: unknown): WorkbenchBrowserIpcBridge => ({
  dispose: vi.fn(),
  syncTopology: vi.fn(),
  syncLayout: vi.fn(),
  navigate: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  reload: vi.fn(),
  stop: vi.fn(),
  readPageState: vi.fn(),
  setElementPickerMode: vi.fn(),
  showAgentElementPickerTarget: vi.fn(),
  clearAgentElementPickerTarget: vi.fn(),
  readActiveTabId: vi.fn(),
  listFrames: vi.fn(),
  probeFrameDom: vi.fn(),
  executeFrameScript: vi.fn().mockResolvedValue(result),
  dispatchNativeInput: vi.fn().mockResolvedValue(undefined),
  fetchWithTabSession: vi.fn(),
  readPageDomSummary: vi.fn(),
  extractPageText: vi.fn(),
  capturePage: vi.fn(),
  reapplyLayout: vi.fn(),
  toggleDevToolsForActivePage: vi.fn()
});

describe("workbench action executor", () => {
  test("preserves draft/submission metadata from frame execution", async () => {
    const bridge = createBridge({
      ok: true,
      method: "type",
      note: "typed text only; no submit action was executed",
      submitted: false,
      draftOnly: true,
      submissionMethod: "none"
    });

    const result = await executeWebAction({
      browserBridge: bridge,
      graph,
      request: {
        action: {
          kind: "type",
          target: {
            candidateId: "candidate-1"
          },
          text: "hello"
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.submitted).toBe(false);
    expect(result.draftOnly).toBe(true);
    expect(result.submissionMethod).toBe("none");
    expect(result.note).toContain("typed text only");
  });

  test("defaults typing without submit metadata to draft-only", async () => {
    const bridge = createBridge({
      ok: true,
      method: "type"
    });

    const result = await executeWebAction({
      browserBridge: bridge,
      graph,
      request: {
        action: {
          kind: "type",
          target: {
            candidateId: "candidate-1"
          },
          text: "hello"
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.submitted).toBe(false);
    expect(result.draftOnly).toBe(true);
    expect(result.submissionMethod).toBe("none");
    expect(result.note).toContain("submission was not confirmed");
  });

  test("marks enter press as draft-only when submit is not confirmed", async () => {
    const bridge = createBridge({
      ok: true,
      method: "press_key",
      submitted: false,
      submissionMethod: "enter"
    });

    const result = await executeWebAction({
      browserBridge: bridge,
      graph,
      request: {
        action: {
          kind: "press_key",
          target: {
            candidateId: "candidate-1"
          },
          key: "Enter"
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.submitted).toBe(false);
    expect(result.draftOnly).toBe(true);
    expect(result.submissionMethod).toBe("enter");
    expect(result.note).toContain("submission was not confirmed");
  });

  test("uses native pointer input for click actions after probing target geometry", async () => {
    const executeFrameScript = vi.fn().mockResolvedValue({
      ok: true,
      x: 320,
      y: 420,
      width: 48,
      height: 32
    });
    const dispatchNativeInput = vi.fn().mockResolvedValue(undefined);
    const bridge = {
      ...createBridge({ ok: true }),
      executeFrameScript,
      dispatchNativeInput
    } satisfies WorkbenchBrowserIpcBridge;

    const clickableGraph: WorkbenchWebGraphSnapshot = {
      ...graph,
      nodes: [{
        ...graph.nodes[0]!,
        tagName: "button",
        interactable: {
          clickable: true,
          typable: false,
          selectable: false,
          focusable: true,
          scrollable: false
        }
      }]
    };

    const result = await executeWebAction({
      browserBridge: bridge,
      graph: clickableGraph,
      request: {
        action: {
          kind: "click",
          target: {
            nodeId: "node-1"
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.execution?.method).toBe("native_click");
    expect(dispatchNativeInput).toHaveBeenCalledTimes(1);
  });

  test("fails click actions when probe detects center-point interception", async () => {
    const bridge = {
      ...createBridge({
        ok: false,
        errorCode: "pointer_intercepted",
        errorMessage: "target center is intercepted by another element",
        details: {
          hitTagName: "div"
        }
      }),
      dispatchNativeInput: vi.fn().mockResolvedValue(undefined)
    } satisfies WorkbenchBrowserIpcBridge;

    const clickableGraph: WorkbenchWebGraphSnapshot = {
      ...graph,
      nodes: [{
        ...graph.nodes[0]!,
        tagName: "button",
        interactable: {
          clickable: true,
          typable: false,
          selectable: false,
          focusable: true,
          scrollable: false
        }
      }]
    };

    await expect(executeWebAction({
      browserBridge: bridge,
      graph: clickableGraph,
      request: {
        action: {
          kind: "click",
          target: {
            nodeId: "node-1"
          }
        }
      }
    })).rejects.toMatchObject({
      code: "pointer_intercepted"
    });
  });
});
