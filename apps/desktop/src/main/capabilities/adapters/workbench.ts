import type { LyraAppManifest } from "@lyra/capability-protocol";

import type {
  WorkbenchWebGraphBuildRequest,
  WorkbenchWebGraphQueryRequest,
  WorkbenchWebTargetIntent,
  WorkbenchWebTargetScanRequest,
  WorkbenchWebWaitRequest
} from "../../../shared/workbench-web-automation";
import type {
  WorkbenchTabExtractTextRequest,
  WorkbenchTabReadRequest,
  WorkbenchTabsListRequest,
  WorkbenchVisualCaptureRequest,
  WorkbenchWorkspaceReadRequest
} from "../../../shared/workbench-observation";
import type { WorkbenchObservationService } from "../../workbench-observation/types";
import type { WorkbenchWebAutomationService } from "../../workbench-web-automation/types";
import {
  parseWorkbenchWebActionRequestPayload,
  WORKBENCH_WEB_MUTATE_ACTION_INPUT_SCHEMA,
  WORKBENCH_WEB_NAVIGATE_ACTION_INPUT_SCHEMA,
  WORKBENCH_WEB_SAFE_ACTION_INPUT_SCHEMA,
} from "../../workbench-web-automation/action-normalizer";
import type { CapabilityRegistry } from "../registry";

const WORKBENCH_APP_ID = "workbench";

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const readBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const readStringArray = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const next = value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => entry !== undefined);
  return next.length > 0 ? next : undefined;
};

const parseWebTargetIntent = (value: unknown): WorkbenchWebTargetIntent => {
  const payload = asRecord(value);
  const operation = readString(payload.operation);
  if (
    operation !== "click"
    && operation !== "type"
    && operation !== "focus"
    && operation !== "select"
    && operation !== "submit"
  ) {
    throw new Error("intent.operation is required");
  }
  const allowContentEditable = readBoolean(payload.allowContentEditable);
  const resolvedAllowContentEditable =
    allowContentEditable === undefined && operation === "type"
      ? true
      : allowContentEditable;
  const desiredRoles = readStringArray(payload.desiredRoles);
  const desiredTags = readStringArray(payload.desiredTags);
  const textHints = readStringArray(payload.textHints);
  const placeholderHints = readStringArray(payload.placeholderHints);
  return {
    operation,
    ...(desiredRoles === undefined ? {} : { desiredRoles }),
    ...(desiredTags === undefined ? {} : { desiredTags }),
    ...(textHints === undefined ? {} : { textHints }),
    ...(placeholderHints === undefined ? {} : { placeholderHints }),
    ...(resolvedAllowContentEditable === undefined
      ? {}
      : { allowContentEditable: resolvedAllowContentEditable })
  };
};

const toWebAutomationCallContext = (
  request: { readonly context?: { readonly aiSessionId?: string; readonly aiTurnId?: string } },
  context: { readonly callId: string }
) => ({
  toolCallId: context.callId,
  ...(request.context?.aiSessionId === undefined ? {} : { agentSessionId: request.context.aiSessionId }),
  ...(request.context?.aiTurnId === undefined ? {} : { agentTurnId: request.context.aiTurnId })
});

export const registerWorkbenchCapabilities = (
  registry: CapabilityRegistry,
  observationService: WorkbenchObservationService,
  webAutomationService: WorkbenchWebAutomationService
): LyraAppManifest => {
  registry.register(
    {
      id: "workbench.tabs.list",
      domain: "workbench",
      kind: "resource",
      title: "List Open Workbench Tabs",
      appId: WORKBENCH_APP_ID,
      operation: "tabs.list",
      description: "List open workbench tabs, including which tabs are active and visible.",
      permissions: ["workbench:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["all", "visible", "active"]
          },
          includeUnsupported: {
            type: "boolean"
          }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const scope = readString(payload.scope) as WorkbenchTabsListRequest["scope"] | undefined;
      const includeUnsupported = readBoolean(payload.includeUnsupported);
      const listRequest: WorkbenchTabsListRequest = {
        ...(scope === undefined ? {} : { scope }),
        ...(includeUnsupported === undefined ? {} : { includeUnsupported })
      };
      return await observationService.listTabs(listRequest);
    }
  );

  registry.register(
    {
      id: "workbench.workspace.read",
      domain: "workbench",
      kind: "resource",
      title: "Read Current Workbench Workspace",
      appId: WORKBENCH_APP_ID,
      operation: "workspace.read",
      description: "Read the currently visible workbench workspace, including split panes.",
      permissions: ["workbench:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        properties: {
          detail: {
            type: "string",
            enum: ["summary", "full"]
          },
          includeVisual: {
            type: "boolean"
          }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const detail = readString(payload.detail) as WorkbenchWorkspaceReadRequest["detail"] | undefined;
      const includeVisual = readBoolean(payload.includeVisual);
      const readRequest: WorkbenchWorkspaceReadRequest = {
        ...(detail === undefined ? {} : { detail }),
        ...(includeVisual === undefined ? {} : { includeVisual })
      };
      return await observationService.readWorkspace(readRequest);
    }
  );

  registry.register(
    {
      id: "workbench.tab.extract_text",
      domain: "workbench",
      kind: "resource",
      title: "Extract Workbench Tab Text",
      appId: WORKBENCH_APP_ID,
      operation: "tab.extract_text",
      description: "Extract copy-like text from a specific workbench tab without modifying the system clipboard. Use this for readable page text, not for locating interactive form controls or buttons. Automatically continues internally to return the most complete text that safely fits the tool-result budget, and exposes cursor-based continuation when more content remains.",
      permissions: ["workbench:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        required: ["tabId"],
        properties: {
          tabId: { type: "string" },
          scope: {
            type: "string",
            enum: ["main", "full"]
          },
          maxChars: { type: "number" },
          cursor: { type: "number" },
          maxEntries: { type: "number" },
          maxBytes: { type: "number" },
          paneId: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object",
        required: [
          "tabId",
          "scope",
          "text",
          "truncated",
          "startChar",
          "endChar",
          "totalChars",
          "hasMore",
          "extractionMethod"
        ],
        properties: {
          tabId: { type: "string" },
          scope: { type: "string", enum: ["main", "full"] },
          text: { type: "string" },
          truncated: { type: "boolean" },
          startChar: { type: "number" },
          endChar: { type: "number" },
          totalChars: { type: "number" },
          hasMore: { type: "boolean" },
          nextCursor: { type: "number" },
          extractionMethod: { type: "string" }
        },
        additionalProperties: false
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const tabId = readString(payload.tabId);
      if (tabId === undefined) {
        throw new Error("tabId is required");
      }
      const scope = readString(payload.scope) as WorkbenchTabExtractTextRequest["scope"] | undefined;
      const maxChars = readNumber(payload.maxChars);
      const cursor = readNumber(payload.cursor);
      const maxEntries = readNumber(payload.maxEntries);
      const maxBytes = readNumber(payload.maxBytes);
      const paneId = readString(payload.paneId);
      const extractRequest: WorkbenchTabExtractTextRequest = {
        tabId,
        ...(scope === undefined ? {} : { scope }),
        ...(maxChars === undefined ? {} : { maxChars }),
        ...(cursor === undefined ? {} : { cursor }),
        ...(maxEntries === undefined ? {} : { maxEntries }),
        ...(maxBytes === undefined ? {} : { maxBytes }),
        ...(paneId === undefined ? {} : { paneId })
      };
      return await observationService.extractTabText(extractRequest);
    }
  );

  registry.register(
    {
      id: "workbench.tab.read",
      domain: "workbench",
      kind: "resource",
      title: "Read Workbench Tab",
      appId: WORKBENCH_APP_ID,
      operation: "tab.read",
      description: "Read the structured contents of a specific workbench tab. Use this for page state, not for selecting individual interactive elements.",
      permissions: ["workbench:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        required: ["tabId"],
        properties: {
          tabId: { type: "string" },
          detail: {
            type: "string",
            enum: ["summary", "full"]
          },
          maxChars: { type: "number" },
          maxEntries: { type: "number" },
          maxBytes: { type: "number" },
          paneId: { type: "string" },
          includeVisual: { type: "boolean" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const tabId = readString(payload.tabId);
      if (tabId === undefined) {
        throw new Error("tabId is required");
      }
      const detail = readString(payload.detail) as WorkbenchTabReadRequest["detail"] | undefined;
      const maxChars = readNumber(payload.maxChars);
      const maxEntries = readNumber(payload.maxEntries);
      const maxBytes = readNumber(payload.maxBytes);
      const paneId = readString(payload.paneId);
      const includeVisual = readBoolean(payload.includeVisual);
      const readRequest: WorkbenchTabReadRequest = {
        tabId,
        ...(detail === undefined ? {} : { detail }),
        ...(maxChars === undefined ? {} : { maxChars }),
        ...(maxEntries === undefined ? {} : { maxEntries }),
        ...(maxBytes === undefined ? {} : { maxBytes }),
        ...(paneId === undefined ? {} : { paneId }),
        ...(includeVisual === undefined ? {} : { includeVisual })
      };
      return await observationService.readTab(readRequest);
    }
  );

  registry.register(
    {
      id: "workbench.tab.capture_visual",
      domain: "workbench",
      kind: "resource",
      title: "Capture Workbench Tab Visual",
      appId: WORKBENCH_APP_ID,
      operation: "tab.capture_visual",
      description: "Capture a visible workbench tab as an image when visual inspection is required.",
      permissions: ["workbench:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        required: ["tabId"],
        properties: {
          tabId: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const tabId = readString(payload.tabId);
      if (tabId === undefined) {
        throw new Error("tabId is required");
      }
      const captureRequest: WorkbenchVisualCaptureRequest = { tabId };
      return await observationService.captureVisual(captureRequest);
    }
  );

  registry.register(
    {
      id: "workbench.web_target.scan",
      domain: "workbench",
      kind: "resource",
      title: "Scan Web Targets",
      appId: WORKBENCH_APP_ID,
      operation: "web_target.scan",
      description: "Scan the active visible page for likely interactive targets using a fast visible-first selector pass.",
      permissions: ["workbench:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        required: ["intent"],
        properties: {
          tabId: { type: "string" },
          scope: { type: "string", enum: ["visible", "nearby", "expanded"] },
          maxCandidates: { type: "number" },
          continuationToken: { type: "string" },
          intent: {
            type: "object",
            required: ["operation"],
            properties: {
              operation: { type: "string", enum: ["click", "type", "focus", "select", "submit"] },
              desiredRoles: { type: "array", items: { type: "string" } },
              desiredTags: { type: "array", items: { type: "string" } },
              textHints: { type: "array", items: { type: "string" } },
              placeholderHints: { type: "array", items: { type: "string" } },
              allowContentEditable: { type: "boolean" }
            },
            additionalProperties: false
          }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request, context) => {
      const payload = asRecord(request.payload);
      const scanRequest: WorkbenchWebTargetScanRequest = {
        intent: parseWebTargetIntent(payload.intent),
        ...(readString(payload.tabId) === undefined ? {} : { tabId: readString(payload.tabId) }),
        ...(readString(payload.scope) === undefined
          ? {}
          : { scope: readString(payload.scope) as WorkbenchWebTargetScanRequest["scope"] }),
        ...(readNumber(payload.maxCandidates) === undefined
          ? {}
          : { maxCandidates: readNumber(payload.maxCandidates) }),
        ...(readString(payload.continuationToken) === undefined
          ? {}
          : { continuationToken: readString(payload.continuationToken) })
      };
      return await webAutomationService.scanTargets(scanRequest, toWebAutomationCallContext(request, context));
    }
  );

  registry.register(
    {
      id: "workbench.web_graph.build",
      domain: "workbench",
      kind: "resource",
      title: "Build Web Element Graph",
      appId: WORKBENCH_APP_ID,
      operation: "web_graph.build",
      description: "Build a structured, selector-addressable graph for the active web page and return highlighted likely input, focus, and click targets.",
      permissions: ["workbench:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "string" },
          detail: { type: "string", enum: ["summary", "full"] },
          forceRefresh: { type: "boolean" },
          maxNodes: { type: "number" },
          maxFrames: { type: "number" },
          maxScrollSteps: { type: "number" },
          maxBuildMs: { type: "number" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const buildRequest: WorkbenchWebGraphBuildRequest = {
        ...(readString(payload.tabId) === undefined ? {} : { tabId: readString(payload.tabId) }),
        ...(readString(payload.detail) === "full" || readString(payload.detail) === "summary"
          ? { detail: readString(payload.detail) as "summary" | "full" }
          : {}),
        ...(readBoolean(payload.forceRefresh) === undefined ? {} : { forceRefresh: readBoolean(payload.forceRefresh) }),
        ...(readNumber(payload.maxNodes) === undefined ? {} : { maxNodes: readNumber(payload.maxNodes) }),
        ...(readNumber(payload.maxFrames) === undefined ? {} : { maxFrames: readNumber(payload.maxFrames) }),
        ...(readNumber(payload.maxScrollSteps) === undefined ? {} : { maxScrollSteps: readNumber(payload.maxScrollSteps) }),
        ...(readNumber(payload.maxBuildMs) === undefined ? {} : { maxBuildMs: readNumber(payload.maxBuildMs) })
      };
      return await webAutomationService.buildGraph(buildRequest);
    }
  );

  registry.register(
    {
      id: "workbench.web_graph.query",
      domain: "workbench",
      kind: "resource",
      title: "Query Web Element Graph",
      appId: WORKBENCH_APP_ID,
      operation: "web_graph.query",
      description: "Query interactable nodes from a previously built page graph and return the best candidate node for the requested action.",
      permissions: ["workbench:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "string" },
          graphId: { type: "string" },
          textContains: { type: "string" },
          text: { type: "string" },
          query: { type: "string" },
          contains: { type: "string" },
          tagName: { type: "string" },
          role: { type: "string" },
          onlyInteractable: { type: "boolean" },
          action: { type: "string", enum: ["click", "type", "select", "focus", "scroll", "submit"] },
          maxResults: { type: "number" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const queryRequest: WorkbenchWebGraphQueryRequest = {
        ...(readString(payload.tabId) === undefined ? {} : { tabId: readString(payload.tabId) }),
        ...(readString(payload.graphId) === undefined ? {} : { graphId: readString(payload.graphId) }),
        ...((readString(payload.textContains)
          ?? readString(payload.text)
          ?? readString(payload.query)
          ?? readString(payload.contains)) === undefined
          ? {}
          : {
              textContains:
                (readString(payload.textContains)
                ?? readString(payload.text)
                ?? readString(payload.query)
                ?? readString(payload.contains))!,
            }),
        ...(readString(payload.tagName) === undefined ? {} : { tagName: readString(payload.tagName) }),
        ...(readString(payload.role) === undefined ? {} : { role: readString(payload.role) }),
        ...(readBoolean(payload.onlyInteractable) === undefined
          ? {}
          : { onlyInteractable: readBoolean(payload.onlyInteractable) }),
        ...(readString(payload.action) === undefined
          ? {}
          : { action: readString(payload.action) as WorkbenchWebGraphQueryRequest["action"] }),
        ...(readNumber(payload.maxResults) === undefined ? {} : { maxResults: readNumber(payload.maxResults) })
      };
      return await webAutomationService.queryGraph(queryRequest);
    }
  );

  registry.register(
    {
      id: "workbench.web_action.safe",
      domain: "workbench",
      kind: "action",
      title: "Run Safe Web Action",
      appId: WORKBENCH_APP_ID,
      operation: "web_action.safe",
      description: "Run safe, read-like web actions such as focus, hover, and probe.",
      permissions: ["workbench:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        ...WORKBENCH_WEB_SAFE_ACTION_INPUT_SCHEMA
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request, context) => {
      const payload = asRecord(request.payload);
      const actionRequest = parseWorkbenchWebActionRequestPayload(payload);
      return await webAutomationService.runSafeAction(
        actionRequest,
        toWebAutomationCallContext(request, context)
      );
    }
  );

  registry.register(
    {
      id: "workbench.web_action.mutate",
      domain: "workbench",
      kind: "action",
      title: "Run Mutating Web Action",
      appId: WORKBENCH_APP_ID,
      operation: "web_action.mutate",
      description: "Run mutating web actions such as click, type, select, and submit. For chat or composer inputs, prefer one-shot clear_and_type with submit=true instead of separate focus/type/read loops. Typing alone may only draft text unless submit is requested or a nearby composer submit control is auto-detected.",
      permissions: ["workbench:read", "workbench:write"],
      risk: "write",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        ...WORKBENCH_WEB_MUTATE_ACTION_INPUT_SCHEMA
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request, context) => {
      const payload = asRecord(request.payload);
      const actionRequest = parseWorkbenchWebActionRequestPayload(payload);
      return await webAutomationService.runMutateAction(
        actionRequest,
        toWebAutomationCallContext(request, context)
      );
    }
  );

  registry.register(
    {
      id: "workbench.web_action.navigate",
      domain: "workbench",
      kind: "action",
      title: "Run Navigation Web Action",
      appId: WORKBENCH_APP_ID,
      operation: "web_action.navigate",
      description: "Run navigation-level web actions including goto URL and history operations.",
      permissions: ["workbench:read", "browser:navigate", "network:http"],
      risk: "network",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        ...WORKBENCH_WEB_NAVIGATE_ACTION_INPUT_SCHEMA
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request, context) => {
      const payload = asRecord(request.payload);
      const actionRequest = parseWorkbenchWebActionRequestPayload(payload);
      return await webAutomationService.runNavigateAction(
        actionRequest,
        toWebAutomationCallContext(request, context)
      );
    }
  );

  registry.register(
    {
      id: "workbench.web_action.wait",
      domain: "workbench",
      kind: "resource",
      title: "Wait for Web Target State",
      appId: WORKBENCH_APP_ID,
      operation: "web_action.wait",
      description: "Wait for a target node state (present/visible/hidden) with timeout.",
      permissions: ["workbench:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        required: ["target"],
        properties: {
          tabId: { type: "string" },
          graphId: { type: "string" },
          target: { type: "object" },
          state: { type: "string", enum: ["present", "visible", "hidden"] },
          timeoutMs: { type: "number" },
          pollIntervalMs: { type: "number" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request, context) => {
      const payload = asRecord(request.payload);
      const target = payload.target;
      if (target === null || typeof target !== "object" || Array.isArray(target)) {
        throw new Error("target is required");
      }
      const waitRequest: WorkbenchWebWaitRequest = {
        ...(readString(payload.tabId) === undefined ? {} : { tabId: readString(payload.tabId) }),
        ...(readString(payload.graphId) === undefined ? {} : { graphId: readString(payload.graphId) }),
        target: target as WorkbenchWebWaitRequest["target"],
        ...(readString(payload.state) === "present" || readString(payload.state) === "visible" || readString(payload.state) === "hidden"
          ? { state: readString(payload.state) as WorkbenchWebWaitRequest["state"] }
          : {}),
        ...(readNumber(payload.timeoutMs) === undefined ? {} : { timeoutMs: readNumber(payload.timeoutMs) }),
        ...(readNumber(payload.pollIntervalMs) === undefined ? {} : { pollIntervalMs: readNumber(payload.pollIntervalMs) })
      };
      return await webAutomationService.waitForTarget(
        waitRequest,
        toWebAutomationCallContext(request, context)
      );
    }
  );

  return {
    id: WORKBENCH_APP_ID,
    title: "Workbench Observation",
    version: "0.1.0",
    source: "builtin",
    permissions: ["workbench:read", "workbench:write", "browser:navigate", "network:http"],
    capabilities: [
      "workbench.tabs.list",
      "workbench.workspace.read",
      "workbench.tab.extract_text",
      "workbench.tab.read",
      "workbench.tab.capture_visual",
      "workbench.web_target.scan",
      "workbench.web_graph.build",
      "workbench.web_graph.query",
      "workbench.web_action.safe",
      "workbench.web_action.mutate",
      "workbench.web_action.navigate",
      "workbench.web_action.wait"
    ],
    compatibility: {
      minApiVersion: "0.1.0",
      platforms: ["macos", "windows", "linux"]
    },
    contributes: {
      surfaces: ["workspace"]
    }
  };
};
