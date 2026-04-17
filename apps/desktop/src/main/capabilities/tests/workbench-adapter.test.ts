import { describe, expect, test, vi } from "vitest";

import type { WorkbenchObservationService } from "../../workbench-observation/types";
import type { WorkbenchWebAutomationService } from "../../workbench-web-automation/types";
import { registerWorkbenchCapabilities } from "../adapters/workbench";
import { CapabilityRegistry } from "../registry";

const createObservationService = (): WorkbenchObservationService => ({
  dispose: vi.fn(),
  listTabs: vi.fn(async () => ({}) as any),
  readWorkspace: vi.fn(async () => ({}) as any),
  extractTabText: vi.fn(async () => ({}) as any),
  readTab: vi.fn(async () => ({}) as any),
  captureVisual: vi.fn(async () => ({}) as any)
} as unknown as WorkbenchObservationService);

const createWebAutomationService = (): WorkbenchWebAutomationService => ({
  dispose: vi.fn(),
  buildGraph: vi.fn(async () => ({}) as any),
  queryGraph: vi.fn(async () => ({}) as any),
  readFocusAtlas: vi.fn(async () => ({}) as any),
  readSkeleton: vi.fn(async () => ({}) as any),
  querySkeleton: vi.fn(async () => ({}) as any),
  readContext: vi.fn(async () => ({}) as any),
  readOperability: vi.fn(async () => ({}) as any),
  probeFocus: vi.fn(async () => ({}) as any),
  scanWidgets: vi.fn(async () => ({}) as any),
  scanTargets: vi.fn(async () => ({
    tabId: "browser-tab-1",
    scope: "visible",
    scanSessionId: "scan-1",
    pageMode: "navigation",
    candidates: [],
    diagnostics: {
      durationMs: 0,
      expanded: false,
      scannedFrames: 1,
      scannedCandidates: 0,
      scrolled: false
    },
    truncated: false
  })),
  scanAndAct: vi.fn(async () => ({}) as any),
  runSafeAction: vi.fn(async () => ({}) as any),
  runMutateAction: vi.fn(async () => ({}) as any),
  runNavigateAction: vi.fn(async () => ({}) as any),
  waitForTarget: vi.fn(async () => ({}) as any)
} as unknown as WorkbenchWebAutomationService);

describe("workbench capability adapter", () => {
  test("routes workbench.web_query.find into the new service method", async () => {
    const observationService = createObservationService();
    const webAutomationService = createWebAutomationService();
    const registry = new CapabilityRegistry(vi.fn());
    registerWorkbenchCapabilities(registry, observationService, webAutomationService);

    const result = await registry.invoke({
      capabilityId: "workbench.web_query.find",
      payload: {
        tabId: "browser-tab-1",
        role: ["button", "menuitem"],
        text: "Recent conversation",
        maxResults: 10
      }
    });

    expect(result.ok).toBe(true);
    expect(webAutomationService.querySkeleton).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-1",
        role: ["button", "menuitem"],
        text: "Recent conversation",
        maxResults: 10
      }),
      expect.any(Object)
    );
  });

  test("maps web_query alias fields into structured query request", async () => {
    const observationService = createObservationService();
    const webAutomationService = createWebAutomationService();
    const registry = new CapabilityRegistry(vi.fn());
    registerWorkbenchCapabilities(registry, observationService, webAutomationService);

    const result = await registry.invoke({
      capabilityId: "workbench.web_query.find",
      payload: {
        tabId: "browser-tab-1",
        role: "button",
        textContains: "thinking",
        ariaLabel: "mode selector",
        nearDistance: 20
      }
    });

    expect(result.ok).toBe(true);
    expect(webAutomationService.querySkeleton).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-1",
        role: "button",
        text: "thinking",
        name: "mode selector"
      }),
      expect.any(Object)
    );
  });

  test("routes workbench.web_skeleton.read into the new service method", async () => {
    const observationService = createObservationService();
    const webAutomationService = createWebAutomationService();
    const registry = new CapabilityRegistry(vi.fn());
    registerWorkbenchCapabilities(registry, observationService, webAutomationService);

    const result = await registry.invoke({
      capabilityId: "workbench.web_skeleton.read",
      payload: {
        tabId: "browser-tab-1",
        scope: "visible",
        maxNodes: 8,
        refresh: true
      }
    });

    expect(result.ok).toBe(true);
    expect(webAutomationService.readSkeleton).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-1",
        scope: "visible",
        maxNodes: 8,
        refresh: true
      }),
      expect.any(Object)
    );
  });

  test("routes workbench.web_context.read into the new service method", async () => {
    const observationService = createObservationService();
    const webAutomationService = createWebAutomationService();
    const registry = new CapabilityRegistry(vi.fn());
    registerWorkbenchCapabilities(registry, observationService, webAutomationService);

    const result = await registry.invoke({
      capabilityId: "workbench.web_context.read",
      payload: {
        tabId: "browser-tab-1",
        scope: "neighborhood",
        nodeRef: {
          nodeId: "candidate-1",
          revision: "atlas-v1"
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(webAutomationService.readContext).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-1",
        scope: "neighborhood",
        nodeRef: {
          nodeId: "candidate-1",
          revision: "atlas-v1"
        }
      }),
      expect.any(Object)
    );
  });

  test("routes workbench.web_focus.probe into the new service method", async () => {
    const observationService = createObservationService();
    const webAutomationService = createWebAutomationService();
    const registry = new CapabilityRegistry(vi.fn());
    registerWorkbenchCapabilities(registry, observationService, webAutomationService);

    const result = await registry.invoke({
      capabilityId: "workbench.web_focus.probe",
      payload: {
        tabId: "browser-tab-1",
        focusRegionId: "region:composer",
        target: {
          candidateId: "candidate-1",
          scanSessionId: "scan-1"
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(webAutomationService.probeFocus).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-1",
        focusRegionId: "region:composer",
        target: {
          candidateId: "candidate-1",
          scanSessionId: "scan-1"
        }
      }),
      expect.any(Object)
    );
  });

  test("routes workbench.web_scan_and_act with structured hints", async () => {
    const observationService = createObservationService();
    const webAutomationService = createWebAutomationService();
    const registry = new CapabilityRegistry(vi.fn());
    registerWorkbenchCapabilities(registry, observationService, webAutomationService);

    const result = await registry.invoke({
      capabilityId: "workbench.web_scan_and_act",
      payload: {
        tabId: "browser-tab-1",
        action: {
          kind: "click",
          target: {
            text: "thinking"
          }
        },
        role: ["button", "menuitem"],
        textContains: "thinking",
        ariaLabel: "mode selector",
        scope: "visible",
        maxCandidates: 24,
        maxLatencyMs: 300,
        followThroughSteps: 1,
        goal: {
          expectedTransitions: ["model_changed"],
          mustAdvance: true
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(webAutomationService.scanAndAct).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-1",
        scope: "visible",
        maxCandidates: 24,
        maxLatencyMs: 300,
        followThroughSteps: 1,
        goal: expect.objectContaining({
          mustAdvance: true
        }),
        targetHints: expect.objectContaining({
          role: ["button", "menuitem"],
          text: "thinking",
          name: "mode selector"
        })
      }),
      expect.any(Object)
    );
  });

  test("synthesizes scan_and_act action target from role array and near hint", async () => {
    const observationService = createObservationService();
    const webAutomationService = createWebAutomationService();
    const registry = new CapabilityRegistry(vi.fn());
    registerWorkbenchCapabilities(registry, observationService, webAutomationService);

    const result = await registry.invoke({
      capabilityId: "workbench.web_scan_and_act",
      payload: {
        tabId: "browser-tab-76",
        action: {
          kind: "hover"
        },
        maxResults: 20,
        near: "对话",
        role: ["button", "link"]
      }
    });

    expect(result.ok).toBe(true);
    expect(webAutomationService.scanAndAct).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-76",
        maxCandidates: 20,
        action: expect.objectContaining({
          kind: "hover",
          target: expect.objectContaining({
            role: "button",
            textContains: "对话"
          })
        }),
        targetHints: expect.objectContaining({
          role: ["button", "link"],
          near: "对话"
        })
      }),
      expect.any(Object)
    );
  });

  test("synthesizes scan_and_act action target from top-level text hints", async () => {
    const observationService = createObservationService();
    const webAutomationService = createWebAutomationService();
    const registry = new CapabilityRegistry(vi.fn());
    registerWorkbenchCapabilities(registry, observationService, webAutomationService);

    const result = await registry.invoke({
      capabilityId: "workbench.web_scan_and_act",
      payload: {
        tabId: "browser-tab-76",
        action: {
          kind: "click"
        },
        role: "button",
        textContains: "Hide side"
      }
    });

    expect(result.ok).toBe(true);
    expect(webAutomationService.scanAndAct).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          kind: "click",
          target: expect.objectContaining({
            role: "button",
            textContains: "Hide side"
          })
        })
      }),
      expect.any(Object)
    );
  });

  test("accepts scan_and_act legacy scan action without explicit target", async () => {
    const observationService = createObservationService();
    const webAutomationService = createWebAutomationService();
    const registry = new CapabilityRegistry(vi.fn());
    registerWorkbenchCapabilities(registry, observationService, webAutomationService);

    const result = await registry.invoke({
      capabilityId: "workbench.web_scan_and_act",
      payload: {
        tabId: "browser-tab-76",
        action: {
          kind: "scan"
        },
        scope: "visible"
      }
    });

    expect(result.ok).toBe(true);
    expect(webAutomationService.scanAndAct).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-76",
        scope: "visible",
        action: expect.objectContaining({
          kind: "expand_probe",
          target: {}
        })
      }),
      expect.any(Object)
    );
  });

  test("maps action-level query_find payload to expand_probe with hints", async () => {
    const observationService = createObservationService();
    const webAutomationService = createWebAutomationService();
    const registry = new CapabilityRegistry(vi.fn());
    registerWorkbenchCapabilities(registry, observationService, webAutomationService);

    const result = await registry.invoke({
      capabilityId: "workbench.web_scan_and_act",
      payload: {
        tabId: "browser-tab-76",
        action: {
          kind: "query_find",
          role: "link",
          near: "Recents",
          maxResults: 6
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(webAutomationService.scanAndAct).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-76",
        maxCandidates: 6,
        action: expect.objectContaining({
          kind: "expand_probe"
        }),
        targetHints: expect.objectContaining({
          role: "link",
          near: "Recents"
        })
      }),
      expect.any(Object)
    );
  });

  test("accepts stringified mutate action payloads", async () => {
    const observationService = createObservationService();
    const webAutomationService = createWebAutomationService();
    const registry = new CapabilityRegistry(vi.fn());
    registerWorkbenchCapabilities(registry, observationService, webAutomationService);

    const result = await registry.invoke({
      capabilityId: "workbench.web_action.mutate",
      payload: {
        tabId: "browser-tab-1",
        action: JSON.stringify({
          kind: "click",
          target: {
            candidateId: "candidate-1",
            scanSessionId: "scan-1"
          }
        })
      }
    });

    expect(result.ok).toBe(true);
    expect(webAutomationService.runMutateAction).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-1",
        action: {
          kind: "click",
          target: {
            candidateId: "candidate-1",
            scanSessionId: "scan-1"
          }
        }
      }),
      expect.any(Object)
    );
  });

  test("auto-routes safe action kinds submitted to mutate tool", async () => {
    const observationService = createObservationService();
    const webAutomationService = createWebAutomationService();
    const registry = new CapabilityRegistry(vi.fn());
    registerWorkbenchCapabilities(registry, observationService, webAutomationService);

    const result = await registry.invoke({
      capabilityId: "workbench.web_action.mutate",
      payload: {
        tabId: "browser-tab-1",
        action: {
          kind: "scroll_into_view",
          target: {
            text: "new chat"
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(webAutomationService.runSafeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-1",
        action: expect.objectContaining({
          kind: "scroll_into_view"
        })
      }),
      expect.any(Object)
    );
    expect(webAutomationService.runMutateAction).not.toHaveBeenCalled();
  });

  test("accepts stringified navigate action payloads", async () => {
    const observationService = createObservationService();
    const webAutomationService = createWebAutomationService();
    const registry = new CapabilityRegistry(vi.fn());
    registerWorkbenchCapabilities(registry, observationService, webAutomationService);

    const result = await registry.invoke({
      capabilityId: "workbench.web_action.navigate",
      payload: {
        tabId: "browser-tab-1",
        action: JSON.stringify({
          kind: "goto_url",
          address: "https://chatgpt.com/",
          target: "active-tab"
        })
      }
    });

    expect(result.ok).toBe(true);
    expect(webAutomationService.runNavigateAction).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-1",
        action: {
          kind: "goto_url",
          address: "https://chatgpt.com/",
          target: "active-tab"
        }
      }),
      expect.any(Object)
    );
  });

  test("resolves active-tab aliases for workbench.tab.read", async () => {
    const observationService = createObservationService();
    vi.mocked(observationService.listTabs).mockResolvedValue({
      activeTabId: "browser-tab-42",
      visibleTabIds: ["browser-tab-42"],
      tabs: []
    } as any);
    const webAutomationService = createWebAutomationService();
    const registry = new CapabilityRegistry(vi.fn());
    registerWorkbenchCapabilities(registry, observationService, webAutomationService);

    const result = await registry.invoke({
      capabilityId: "workbench.tab.read",
      payload: {
        tabId: "active-tab",
        detail: "summary"
      }
    });

    expect(result.ok).toBe(true);
    expect(observationService.readTab).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-42",
        detail: "summary"
      })
    );
  });

  test("resolves current-tab aliases for workbench.tab.extract_text", async () => {
    const observationService = createObservationService();
    vi.mocked(observationService.listTabs).mockResolvedValue({
      activeTabId: "browser-tab-9",
      visibleTabIds: ["browser-tab-9"],
      tabs: []
    } as any);
    const webAutomationService = createWebAutomationService();
    const registry = new CapabilityRegistry(vi.fn());
    registerWorkbenchCapabilities(registry, observationService, webAutomationService);

    const result = await registry.invoke({
      capabilityId: "workbench.tab.extract_text",
      payload: {
        tabId: "current-tab"
      }
    });

    expect(result.ok).toBe(true);
    expect(observationService.extractTabText).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-9"
      })
    );
  });

  test("resolves active alias for workbench.tab.read", async () => {
    const observationService = createObservationService();
    vi.mocked(observationService.listTabs).mockResolvedValue({
      activeTabId: "browser-tab-15",
      visibleTabIds: ["browser-tab-15"],
      tabs: []
    } as any);
    const webAutomationService = createWebAutomationService();
    const registry = new CapabilityRegistry(vi.fn());
    registerWorkbenchCapabilities(registry, observationService, webAutomationService);

    const result = await registry.invoke({
      capabilityId: "workbench.tab.read",
      payload: {
        tabId: "active"
      }
    });

    expect(result.ok).toBe(true);
    expect(observationService.readTab).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser-tab-15"
      })
    );
  });
});
