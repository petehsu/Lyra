import { describe, expect, test, vi } from "vitest";

import { executeWebAction, waitForTarget } from "../action-executor";
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

const candidateGraph: WorkbenchWebGraphSnapshot = {
  ...graph,
  nodes: graph.nodes.map((node) => ({
    ...node,
    nodeId: "candidate-1"
  }))
};

const verificationSnapshot = (overrides?: Partial<Record<string, unknown>>) => ({
  url: "https://example.com/chat",
  title: "Example",
  targetPresent: true,
  targetValue: "",
  targetText: "",
  checked: false,
  activeTag: "textarea",
  widgetText: "conversation",
  widgetBusy: false,
  localActionCount: 1,
  transientMenuCount: 0,
  selectedState: "",
  listFingerprint: "",
  ...overrides
});

const createBridge = (results: readonly unknown[]): WorkbenchBrowserIpcBridge => {
  const queue = [...results];
  return ({
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
  executeFrameScript: vi.fn().mockImplementation(async () => {
    if (queue.length === 0) {
      throw new Error("missing executeFrameScript mock result");
    }
    return queue.shift();
  }),
  dispatchNativeInput: vi.fn().mockResolvedValue(undefined),
  openDebuggerSession: vi.fn(),
  fetchWithTabSession: vi.fn(),
  readPageDomSummary: vi.fn(),
  extractPageText: vi.fn(),
  capturePage: vi.fn(),
  resolveFrameGlobalBounds: vi.fn().mockResolvedValue(null),
  reapplyLayout: vi.fn(),
  toggleDevToolsForActivePage: vi.fn()
  });
};

describe("workbench action executor", () => {
  test("preserves draft/submission metadata from frame execution", async () => {
    const bridge = createBridge([
      verificationSnapshot({ targetValue: "" }),
      {
        ok: true,
        x: 320,
        y: 420,
        width: 300,
        height: 24
      },
      {
        ok: true,
        method: "type",
        note: "typed text only; no submit action was executed",
        submitted: false,
        draftOnly: true,
        submissionMethod: "none"
      },
      verificationSnapshot({ targetValue: "hello" })
    ]);

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
    const bridge = createBridge([
      verificationSnapshot({ targetValue: "" }),
      {
        ok: true,
        x: 320,
        y: 420,
        width: 300,
        height: 24
      },
      {
        ok: true,
        method: "type"
      },
      verificationSnapshot({ targetValue: "hello" })
    ]);

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
    const bridge = createBridge([
      verificationSnapshot({ widgetText: "before response" }),
      {
        ok: true,
        method: "press_key",
        submitted: false,
        submissionMethod: "enter"
      },
      verificationSnapshot({ widgetText: "before response hello" })
    ]);

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

  test("auto-resolves generic document selectors for typing actions", async () => {
    const bridge = createBridge([
      verificationSnapshot({ targetValue: "" }),
      {
        ok: true,
        x: 320,
        y: 420,
        width: 300,
        height: 24
      },
      {
        ok: true,
        method: "type",
        submitted: false,
        draftOnly: true,
        submissionMethod: "none"
      },
      verificationSnapshot({ targetValue: "hello" })
    ]);

    const result = await executeWebAction({
      browserBridge: bridge,
      graph,
      request: {
        action: {
          kind: "type",
          target: {
            cssSelector: "*"
          },
          text: "hello"
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.submitted).toBe(false);
  });

  test("uses native pointer input for click actions after probing target geometry", async () => {
    const executeFrameScript = vi.fn();
    executeFrameScript
      .mockResolvedValueOnce(verificationSnapshot({ widgetText: "before click" }))
      .mockResolvedValueOnce({
        ok: true,
        x: 320,
        y: 420,
        width: 48,
        height: 32
      })
      .mockResolvedValueOnce(verificationSnapshot({ widgetText: "after click" }));
    const dispatchNativeInput = vi.fn().mockResolvedValue(undefined);
    const bridge = {
      ...createBridge([]),
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
    expect(result.verified).toBe(true);
    expect(dispatchNativeInput).toHaveBeenCalledTimes(1);
  });

  test("resolves click targets by candidateId when graph node ids come from scan candidates", async () => {
    const bridge = createBridge([
      verificationSnapshot({ widgetText: "before click" }),
      {
        ok: true,
        x: 320,
        y: 420,
        width: 300,
        height: 24
      },
      {
        ok: true,
        method: "native_click"
      },
      verificationSnapshot({ widgetText: "after click", localActionCount: 2 })
    ]);

    const result = await executeWebAction({
      browserBridge: bridge,
      graph: candidateGraph,
      request: {
        action: {
          kind: "click",
          target: {
            candidateId: "candidate-1"
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.execution?.resolvedNodeId).toBe("candidate-1");
    expect(result.execution?.method).toBe("native_click");
  });

  test("resolves click targets by indexed semantic hints when text snippet is weak", async () => {
    const bridge = createBridge([
      verificationSnapshot({ widgetText: "before click" }),
      {
        ok: true,
        x: 220,
        y: 320,
        width: 40,
        height: 24
      },
      verificationSnapshot({ widgetText: "after click", localActionCount: 2 })
    ]);

    const indexedGraph: WorkbenchWebGraphSnapshot = {
      ...graph,
      nodes: [
        {
          ...graph.nodes[0]!,
          nodeId: "button-1",
          tagName: "button",
          role: "button",
          bounds: {
            x: 20,
            y: 40,
            width: 88,
            height: 32
          },
          interactable: {
            clickable: true,
            typable: false,
            selectable: false,
            focusable: true,
            scrollable: false
          }
        },
        {
          ...graph.nodes[0]!,
          nodeId: "button-2",
          tagName: "button",
          role: "button",
          bounds: {
            x: 20,
            y: 90,
            width: 88,
            height: 32
          },
          interactable: {
            clickable: true,
            typable: false,
            selectable: false,
            focusable: true,
            scrollable: false
          }
        }
      ]
    };

    const result = await executeWebAction({
      browserBridge: bridge,
      graph: indexedGraph,
      request: {
        action: {
          kind: "click",
          target: {
            role: "button",
            textSnippet: "…",
            index: 1
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.execution?.resolvedNodeId).toBe("button-2");
    expect(result.note).toContain("indexed semantic hint");
  });

  test("uses native pointer movement for hover actions", async () => {
    const executeFrameScript = vi.fn();
    executeFrameScript
      .mockResolvedValueOnce(verificationSnapshot({ localActionCount: 1 }))
      .mockResolvedValueOnce({
        ok: true,
        x: 320,
        y: 420,
        width: 48,
        height: 32
      })
      .mockResolvedValueOnce(verificationSnapshot({ localActionCount: 3 }));
    const dispatchNativeInput = vi.fn().mockResolvedValue(undefined);
    const bridge = {
      ...createBridge([]),
      executeFrameScript,
      dispatchNativeInput
    } satisfies WorkbenchBrowserIpcBridge;

    const clickableGraph: WorkbenchWebGraphSnapshot = {
      ...graph,
      nodes: [{
        ...graph.nodes[0]!,
        tagName: "button",
        widgetKind: "list-item",
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
          kind: "hover",
          target: {
            nodeId: "node-1"
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.execution?.method).toBe("native_hover");
    expect(result.verified).toBe(true);
    expect(dispatchNativeInput).toHaveBeenCalledTimes(1);
  });

  test("verifies sidebar expand clicks from collapsed to expanded state", async () => {
    const executeFrameScript = vi.fn();
    executeFrameScript
      .mockResolvedValueOnce(verificationSnapshot({ stateHint: "collapsed" }))
      .mockResolvedValueOnce({
        ok: true,
        x: 24,
        y: 24,
        width: 36,
        height: 36
      })
      .mockResolvedValueOnce(verificationSnapshot({ stateHint: "expanded" }));
    const dispatchNativeInput = vi.fn().mockResolvedValue(undefined);
    const bridge = {
      ...createBridge([]),
      executeFrameScript,
      dispatchNativeInput
    } satisfies WorkbenchBrowserIpcBridge;

    const sidebarGraph: WorkbenchWebGraphSnapshot = {
      ...graph,
      nodes: [{
        ...graph.nodes[0]!,
        tagName: "button",
        widgetKind: "sidebar",
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
      graph: sidebarGraph,
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
    expect(result.verified).toBe(true);
    expect(result.verification?.stateTransition).toBe("region_expanded");
    expect(dispatchNativeInput).toHaveBeenCalledTimes(1);
  });

  test("keeps polling verification long enough to observe delayed sidebar expansion", async () => {
    const executeFrameScript = vi.fn();
    executeFrameScript
      .mockResolvedValueOnce(verificationSnapshot({ stateHint: "collapsed" }))
      .mockResolvedValueOnce({
        ok: true,
        x: 24,
        y: 24,
        width: 36,
        height: 36
      })
      .mockResolvedValueOnce(verificationSnapshot({ stateHint: "collapsed" }))
      .mockResolvedValueOnce(verificationSnapshot({ stateHint: "expanded" }));
    const dispatchNativeInput = vi.fn().mockResolvedValue(undefined);
    const bridge = {
      ...createBridge([]),
      executeFrameScript,
      dispatchNativeInput
    } satisfies WorkbenchBrowserIpcBridge;

    const sidebarGraph: WorkbenchWebGraphSnapshot = {
      ...graph,
      nodes: [{
        ...graph.nodes[0]!,
        tagName: "button",
        widgetKind: "sidebar",
        ownerWidgetId: "sidebar-root",
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
      graph: sidebarGraph,
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
    expect(result.verified).toBe(true);
    expect(result.verification?.stateTransition).toBe("region_expanded");
    expect(executeFrameScript).toHaveBeenCalledTimes(4);
  });

  test("classifies failed sidebar expansion as workflow_not_advanced instead of list diff failure", async () => {
    const scriptedResults: unknown[] = [
      verificationSnapshot({ stateHint: "collapsed" }),
      {
        ok: true,
        x: 24,
        y: 24,
        width: 36,
        height: 36
      },
      verificationSnapshot({ stateHint: "collapsed" })
    ];
    const executeFrameScript = vi.fn().mockImplementation(async () =>
      scriptedResults.shift() ?? verificationSnapshot({ stateHint: "collapsed" })
    );
    const bridge = {
      ...createBridge([]),
      executeFrameScript,
      dispatchNativeInput: vi.fn().mockResolvedValue(undefined)
    } satisfies WorkbenchBrowserIpcBridge;

    const sidebarGraph: WorkbenchWebGraphSnapshot = {
      ...graph,
      nodes: [{
        ...graph.nodes[0]!,
        tagName: "button",
        widgetKind: "sidebar",
        ownerWidgetId: "sidebar-root",
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
      graph: sidebarGraph,
      request: {
        action: {
          kind: "click",
          target: {
            nodeId: "node-1"
          }
        }
      }
    })).rejects.toMatchObject({
      code: "workflow_not_advanced"
    });
  });

  test("treats toggle-group click as menu_opened when transient panel appears", async () => {
    const executeFrameScript = vi.fn();
    executeFrameScript
      .mockResolvedValueOnce(verificationSnapshot({
        transientMenuCount: 0,
        selectedState: "",
        localActionCount: 1
      }))
      .mockResolvedValueOnce({
        ok: true,
        x: 24,
        y: 24,
        width: 36,
        height: 36
      })
      .mockResolvedValueOnce(verificationSnapshot({
        transientMenuCount: 2,
        selectedState: "",
        localActionCount: 2
      }));
    const dispatchNativeInput = vi.fn().mockResolvedValue(undefined);
    const bridge = {
      ...createBridge([]),
      executeFrameScript,
      dispatchNativeInput
    } satisfies WorkbenchBrowserIpcBridge;

    const switcherGraph: WorkbenchWebGraphSnapshot = {
      ...graph,
      nodes: [{
        ...graph.nodes[0]!,
        tagName: "button",
        widgetKind: "toggle-group",
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
      graph: switcherGraph,
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
    expect(result.verified).toBe(true);
    expect(result.verification?.stateTransition).toBe("menu_opened");
  });

  test("resolves hover targets by candidateId when graph node ids come from scan candidates", async () => {
    const bridge = createBridge([
      verificationSnapshot({ widgetText: "before hover" }),
      {
        ok: true,
        x: 320,
        y: 420,
        width: 300,
        height: 24
      },
      {
        ok: true,
        method: "hover"
      },
      verificationSnapshot({ transientMenuCount: 1 })
    ]);

    const result = await executeWebAction({
      browserBridge: bridge,
      graph: candidateGraph,
      request: {
        action: {
          kind: "hover",
          target: {
            candidateId: "candidate-1"
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.execution?.resolvedNodeId).toBe("candidate-1");
    expect(result.execution?.method).toBe("native_hover");
  });

  test("resolves click targets from nodeRef when candidateId/nodeId are absent", async () => {
    const bridge = createBridge([
      verificationSnapshot({ widgetText: "before click" }),
      {
        ok: true,
        x: 320,
        y: 420,
        width: 300,
        height: 24
      },
      verificationSnapshot({ widgetText: "after click", localActionCount: 2 })
    ]);

    const result = await executeWebAction({
      browserBridge: bridge,
      graph: candidateGraph,
      request: {
        action: {
          kind: "click",
          target: {
            nodeRef: {
              nodeId: "candidate-1",
              revision: "rev-1"
            }
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.execution?.resolvedNodeId).toBe("candidate-1");
    expect(result.execution?.method).toBe("native_click");
  });

  test("falls back to DOM click when native pointer probe reports interception", async () => {
    const bridge = {
      ...createBridge([
        verificationSnapshot(),
        {
          ok: false,
          errorCode: "pointer_intercepted",
          errorMessage: "target center is intercepted by another element",
          details: {
            hitTagName: "div"
          }
        },
        {
          ok: true,
          method: "click"
        },
        verificationSnapshot({ widgetText: "after click", localActionCount: 2 })
      ]),
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
    expect(result.execution?.method).toBe("click");
    expect(result.verified).toBe(true);
  });

  test("rejects overly broad click targets to avoid random interactions", async () => {
    const bridge = createBridge([]);

    await expect(executeWebAction({
      browserBridge: bridge,
      graph,
      request: {
        action: {
          kind: "click",
          target: {
            role: "button"
          }
        }
      }
    })).rejects.toMatchObject({
      code: "invalid_request"
    });
  });

  test("accepts submitted typing when submit is acknowledged and input is empty", async () => {
    const bridge = createBridge([
      verificationSnapshot({
        targetValue: "",
        targetText: "chat with assistant",
        widgetText: "conversation"
      }),
      {
        ok: true,
        x: 320,
        y: 420,
        width: 300,
        height: 24
      },
      {
        ok: true,
        method: "clear_and_type",
        submitted: true,
        submissionMethod: "enter"
      },
      verificationSnapshot({
        targetValue: "",
        targetText: "chat with assistant",
        widgetText: "conversation"
      })
    ]);

    const composerGraph: WorkbenchWebGraphSnapshot = {
      ...graph,
      nodes: [{
        ...graph.nodes[0]!,
        widgetKind: "chat-composer"
      }]
    };

    const result = await executeWebAction({
      browserBridge: bridge,
      graph: composerGraph,
      request: {
        action: {
          kind: "clear_and_type",
          target: {
            candidateId: "node-1"
          },
          text: "hello",
          submit: true
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.verification?.stateTransition).toBe("message_submitted");
  });

  test("rejects submit acknowledgement on search-like typing surfaces", async () => {
    const scriptedResults: unknown[] = [
      verificationSnapshot({
        targetValue: "",
        targetText: "search",
        widgetText: "search",
        localActionCount: 0
      }),
      {
        ok: true,
        x: 120,
        y: 120,
        width: 280,
        height: 24
      },
      {
        ok: true,
        method: "clear_and_type",
        submitted: true,
        submissionMethod: "enter"
      },
      verificationSnapshot({
        targetValue: "",
        targetText: "search",
        widgetText: "search",
        localActionCount: 0
      })
    ];
    const executeFrameScript = vi.fn().mockImplementation(async () =>
      scriptedResults.shift() ?? verificationSnapshot({
        targetValue: "",
        targetText: "search",
        widgetText: "search",
        localActionCount: 0
      })
    );
    const bridge = {
      ...createBridge([]),
      executeFrameScript,
      dispatchNativeInput: vi.fn().mockResolvedValue(undefined)
    } satisfies WorkbenchBrowserIpcBridge;

    const searchGraph: WorkbenchWebGraphSnapshot = {
      ...graph,
      nodes: [{
        ...graph.nodes[0]!,
        widgetKind: "search-bar",
        stableSignature: {
          ...graph.nodes[0]!.stableSignature,
          id: "search-input",
          name: "search"
        }
      }]
    };

    await expect(executeWebAction({
      browserBridge: bridge,
      graph: searchGraph,
      request: {
        action: {
          kind: "clear_and_type",
          target: {
            candidateId: "node-1"
          },
          text: "hello",
          submit: true
        }
      }
    })).rejects.toMatchObject({
      code: "wrong_widget_target"
    });
  });

  test("rejects javascript pseudo-navigation", async () => {
    const bridge = createBridge([]);

    await expect(executeWebAction({
      browserBridge: bridge,
      graph,
      request: {
        action: {
          kind: "goto_url",
          address: "javascript:alert('x')"
        }
      }
    })).rejects.toMatchObject({
      code: "action_blocked_by_policy"
    });
  });

  test("wait resolves nodeRef-only targets", async () => {
    const bridge = createBridge([{ ok: true }]);

    const result = await waitForTarget({
      browserBridge: bridge,
      graph: candidateGraph,
      request: {
        target: {
          nodeRef: {
            nodeId: "candidate-1",
            revision: "rev-1"
          }
        },
        state: "visible",
        timeoutMs: 500
      }
    });

    expect(result.satisfied).toBe(true);
    expect(result.execution?.resolvedNodeId).toBe("candidate-1");
  });

  test("wait resolves semantic targets by role and text hints", async () => {
    const bridge = createBridge([{ ok: true }]);

    const semanticGraph: WorkbenchWebGraphSnapshot = {
      ...graph,
      nodes: [{
        ...graph.nodes[0]!,
        nodeId: "link-1",
        tagName: "a",
        role: "link",
        textSnippet: "New chat",
        interactable: {
          clickable: true,
          typable: false,
          selectable: false,
          focusable: true,
          scrollable: false
        }
      }]
    };

    const result = await waitForTarget({
      browserBridge: bridge,
      graph: semanticGraph,
      request: {
        target: {
          role: "link",
          text: "New chat"
        },
        state: "visible",
        timeoutMs: 500
      }
    });

    expect(result.satisfied).toBe(true);
    expect(result.execution?.resolvedNodeId).toBe("link-1");
  });

  test("wait resolves indexed semantic targets when weak text hints are present", async () => {
    const bridge = createBridge([{ ok: true }]);

    const indexedGraph: WorkbenchWebGraphSnapshot = {
      ...graph,
      nodes: [
        {
          ...graph.nodes[0]!,
          nodeId: "button-1",
          tagName: "button",
          role: "button",
          textSnippet: "First",
          interactable: {
            clickable: true,
            typable: false,
            selectable: false,
            focusable: true,
            scrollable: false
          }
        },
        {
          ...graph.nodes[0]!,
          nodeId: "button-2",
          tagName: "button",
          role: "button",
          textSnippet: "Second",
          interactable: {
            clickable: true,
            typable: false,
            selectable: false,
            focusable: true,
            scrollable: false
          }
        }
      ]
    };

    const result = await waitForTarget({
      browserBridge: bridge,
      graph: indexedGraph,
      request: {
        target: {
          role: "button",
          textSnippet: "...",
          index: 1
        },
        state: "visible",
        timeoutMs: 500
      }
    });

    expect(result.satisfied).toBe(true);
    expect(result.execution?.resolvedNodeId).toBe("button-2");
  });
});
