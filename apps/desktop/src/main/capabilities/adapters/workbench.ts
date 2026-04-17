import type { LyraAppManifest } from "@lyra/capability-protocol";

import type {
  WorkbenchWebContextReadRequest,
  WorkbenchWebFocusProbeRequest,
  WorkbenchWebQueryRequest,
  WorkbenchWebScanAndActRequest,
  WorkbenchWebSkeletonReadRequest,
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

const readTargetRole = (value: unknown): string | undefined =>
  readString(value) ?? readStringArray(value)?.[0];

const readObject = (value: unknown): Record<string, unknown> | undefined => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
};

const readFirstString = (...values: readonly unknown[]): string | undefined => {
  for (const value of values) {
    const normalized = readString(value);
    if (normalized !== undefined) {
      return normalized;
    }
  }
  return undefined;
};

const readFirstNumber = (...values: readonly unknown[]): number | undefined => {
  for (const value of values) {
    const normalized = readNumber(value);
    if (normalized !== undefined) {
      return normalized;
    }
  }
  return undefined;
};

const buildScanAndActFallbackTarget = (
  payload: Record<string, unknown>,
  actionInput: Record<string, unknown>
): Record<string, unknown> => {
  const candidateId = readFirstString(actionInput.candidateId, payload.candidateId);
  const scanSessionId = readFirstString(actionInput.scanSessionId, payload.scanSessionId);
  const nodeId = readFirstString(actionInput.nodeId, payload.nodeId);
  const index = readFirstNumber(actionInput.index, payload.index);
  const nodeRef = readObject(actionInput.nodeRef) ?? readObject(payload.nodeRef);
  const cssSelector = readFirstString(
    actionInput.cssSelector,
    actionInput.selector,
    payload.cssSelector,
    payload.selector
  );
  const selectorAddress = readObject(actionInput.selectorAddress) ?? readObject(payload.selectorAddress);
  const stableSignature = readObject(actionInput.stableSignature) ?? readObject(payload.stableSignature);
  const tagName = readFirstString(actionInput.tagName, payload.tagName);
  const role = readTargetRole(actionInput.role) ?? readTargetRole(payload.role);
  const inputType = readFirstString(actionInput.inputType, payload.inputType);
  const id = readFirstString(actionInput.id, payload.id);
  const name = readFirstString(actionInput.name, payload.name);
  const testId = readFirstString(actionInput.testId, payload.testId);
  const ariaLabel = readFirstString(actionInput.ariaLabel, payload.ariaLabel);
  const text = readFirstString(actionInput.text, payload.text);
  const textContains = readFirstString(
    actionInput.textContains,
    payload.textContains,
    actionInput.near,
    payload.near,
    actionInput.within,
    payload.within
  );
  const textSnippet = readFirstString(actionInput.textSnippet, payload.textSnippet);
  const placeholder = readFirstString(actionInput.placeholder, payload.placeholder);
  const label = readFirstString(actionInput.label, payload.label);
  return {
    ...(candidateId === undefined ? {} : { candidateId }),
    ...(scanSessionId === undefined ? {} : { scanSessionId }),
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(index === undefined ? {} : { index }),
    ...(nodeRef === undefined ? {} : { nodeRef }),
    ...(cssSelector === undefined ? {} : { cssSelector }),
    ...(selectorAddress === undefined ? {} : { selectorAddress }),
    ...(stableSignature === undefined ? {} : { stableSignature }),
    ...(tagName === undefined ? {} : { tagName }),
    ...(role === undefined ? {} : { role }),
    ...(inputType === undefined ? {} : { inputType }),
    ...(id === undefined ? {} : { id }),
    ...(name === undefined ? {} : { name }),
    ...(testId === undefined ? {} : { testId }),
    ...(ariaLabel === undefined ? {} : { ariaLabel }),
    ...(text === undefined ? {} : { text }),
    ...(textContains === undefined ? {} : { textContains }),
    ...(textSnippet === undefined ? {} : { textSnippet }),
    ...(placeholder === undefined ? {} : { placeholder }),
    ...(label === undefined ? {} : { label }),
  };
};

const parseQueryStateFilter = (
  value: unknown
): WorkbenchWebQueryRequest["state"] | undefined => {
  const payload = asRecord(value);
  const checked = readBoolean(payload.checked);
  const selected = readBoolean(payload.selected);
  const expanded = readBoolean(payload.expanded);
  const disabled = readBoolean(payload.disabled);
  const invalid = readBoolean(payload.invalid);
  const required = readBoolean(payload.required);
  const readonly = readBoolean(payload.readonly);
  const visible = readBoolean(payload.visible);
  if (
    checked === undefined
    && selected === undefined
    && expanded === undefined
    && disabled === undefined
    && invalid === undefined
    && required === undefined
    && readonly === undefined
    && visible === undefined
  ) {
    return undefined;
  }
  return {
    ...(checked === undefined ? {} : { checked }),
    ...(selected === undefined ? {} : { selected }),
    ...(expanded === undefined ? {} : { expanded }),
    ...(disabled === undefined ? {} : { disabled }),
    ...(invalid === undefined ? {} : { invalid }),
    ...(required === undefined ? {} : { required }),
    ...(readonly === undefined ? {} : { readonly }),
    ...(visible === undefined ? {} : { visible })
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

const resolveObservationTabId = async (
  observationService: WorkbenchObservationService,
  requestedTabId: string
): Promise<string> => {
  if (
    requestedTabId !== "active-tab"
    && requestedTabId !== "current-tab"
    && requestedTabId !== "active"
    && requestedTabId !== "current"
  ) {
    return requestedTabId;
  }
  const listed = await observationService.listTabs({
    scope: "visible"
  });
  if (typeof listed.activeTabId === "string" && listed.activeTabId.trim().length > 0) {
    return listed.activeTabId;
  }
  throw new Error(`Unknown tab: ${requestedTabId}`);
};

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
      const requestedTabId = readString(payload.tabId);
      const tabId = requestedTabId === undefined
        ? undefined
        : await resolveObservationTabId(observationService, requestedTabId);
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
      const requestedTabId = readString(payload.tabId);
      const tabId = requestedTabId === undefined
        ? undefined
        : await resolveObservationTabId(observationService, requestedTabId);
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
      const requestedTabId = readString(payload.tabId);
      const tabId = requestedTabId === undefined
        ? undefined
        : await resolveObservationTabId(observationService, requestedTabId);
      if (tabId === undefined) {
        throw new Error("tabId is required");
      }
      const captureRequest: WorkbenchVisualCaptureRequest = { tabId };
      return await observationService.captureVisual(captureRequest);
    }
  );

  registry.register(
    {
      id: "workbench.web_skeleton.read",
      domain: "workbench",
      kind: "resource",
      title: "Read Web Skeleton",
      appId: WORKBENCH_APP_ID,
      operation: "web_skeleton.read",
      description: "Read the current page's human-operable skeleton without taking over the page.",
      permissions: ["workbench:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "string" },
          scope: { type: "string", enum: ["visible", "nearby", "expanded"] },
          maxNodes: { type: "number" },
          refresh: { type: "boolean" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request, context) => {
      const payload = asRecord(request.payload);
      const skeletonRequest: WorkbenchWebSkeletonReadRequest = {
        ...(readString(payload.tabId) === undefined ? {} : { tabId: readString(payload.tabId) }),
        ...(readString(payload.scope) === undefined
          ? {}
          : { scope: readString(payload.scope) as WorkbenchWebSkeletonReadRequest["scope"] }),
        ...(readNumber(payload.maxNodes) === undefined ? {} : { maxNodes: readNumber(payload.maxNodes) }),
        ...(readBoolean(payload.refresh) === undefined ? {} : { refresh: readBoolean(payload.refresh) })
      };
      return await webAutomationService.readSkeleton(
        skeletonRequest,
        toWebAutomationCallContext(request, context)
      );
    }
  );

  registry.register(
    {
      id: "workbench.web_query.find",
      domain: "workbench",
      kind: "resource",
      title: "Find Web Skeleton Nodes",
      appId: WORKBENCH_APP_ID,
      operation: "web_query.find",
      description: "Find human-operable controls from the current page skeleton using structured query constraints.",
      permissions: ["workbench:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "string" },
          role: {
            oneOf: [
              { type: "string" },
              { type: "array", items: { type: "string" } }
            ]
          },
          name: { type: "string" },
          text: { type: "string" },
          textContains: { type: "string" },
          textSnippet: { type: "string" },
          ariaLabel: { type: "string" },
          label: { type: "string" },
          placeholder: { type: "string" },
          within: { type: "string" },
          near: { type: "string" },
          nearDistance: { type: "number" },
          regionId: { type: "string" },
          groupId: { type: "string" },
          index: { type: "number" },
          maxResults: { type: "number" },
          inDialog: { type: "boolean" },
          underMenu: { type: "boolean" },
          inTableRow: { type: "boolean" },
          before: { type: "string" },
          after: { type: "string" },
          currentSubgoal: { type: "string" },
          state: {
            type: "object",
            properties: {
              checked: { type: "boolean" },
              selected: { type: "boolean" },
              expanded: { type: "boolean" },
              disabled: { type: "boolean" },
              invalid: { type: "boolean" },
              required: { type: "boolean" },
              readonly: { type: "boolean" },
              visible: { type: "boolean" }
            },
            additionalProperties: false
          },
          refresh: { type: "boolean" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request, context) => {
      const payload = asRecord(request.payload);
      const role = readString(payload.role) ?? readStringArray(payload.role);
      const resolvedText =
        readString(payload.text)
        ?? readString(payload.textContains)
        ?? readString(payload.textSnippet);
      const resolvedName =
        readString(payload.name)
        ?? readString(payload.ariaLabel)
        ?? readString(payload.label)
        ?? readString(payload.placeholder);
      const queryRequest: WorkbenchWebQueryRequest = {
        ...(readString(payload.tabId) === undefined ? {} : { tabId: readString(payload.tabId) }),
        ...(role === undefined ? {} : { role }),
        ...(resolvedName === undefined ? {} : { name: resolvedName }),
        ...(resolvedText === undefined ? {} : { text: resolvedText }),
        ...(readString(payload.within) === undefined ? {} : { within: readString(payload.within) }),
        ...(readString(payload.near) === undefined ? {} : { near: readString(payload.near) }),
        ...(readString(payload.regionId) === undefined ? {} : { regionId: readString(payload.regionId) }),
        ...(readString(payload.groupId) === undefined ? {} : { groupId: readString(payload.groupId) }),
        ...(readNumber(payload.index) === undefined ? {} : { index: readNumber(payload.index) }),
        ...(readNumber(payload.maxResults) === undefined ? {} : { maxResults: readNumber(payload.maxResults) }),
        ...(readBoolean(payload.inDialog) === undefined ? {} : { inDialog: readBoolean(payload.inDialog) }),
        ...(readBoolean(payload.underMenu) === undefined ? {} : { underMenu: readBoolean(payload.underMenu) }),
        ...(readBoolean(payload.inTableRow) === undefined ? {} : { inTableRow: readBoolean(payload.inTableRow) }),
        ...(readString(payload.before) === undefined ? {} : { before: readString(payload.before) }),
        ...(readString(payload.after) === undefined ? {} : { after: readString(payload.after) }),
        ...(readString(payload.currentSubgoal) === undefined
          ? {}
          : { currentSubgoal: readString(payload.currentSubgoal) }),
        ...(parseQueryStateFilter(payload.state) === undefined
          ? {}
          : { state: parseQueryStateFilter(payload.state) }),
        ...(readBoolean(payload.refresh) === undefined
          ? {}
          : { refresh: readBoolean(payload.refresh) })
      };
      return await webAutomationService.querySkeleton(
        queryRequest,
        toWebAutomationCallContext(request, context)
      );
    }
  );

  registry.register(
    {
      id: "workbench.web_context.read",
      domain: "workbench",
      kind: "resource",
      title: "Read Web Context",
      appId: WORKBENCH_APP_ID,
      operation: "web_context.read",
      description: "Read node, neighborhood, region, or page context around a skeleton node using budgeted local structure.",
      permissions: ["workbench:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "string" },
          regionId: { type: "string" },
          scope: { type: "string", enum: ["node", "neighborhood", "region", "page"] },
          maxNodes: { type: "number" },
          currentSubgoal: { type: "string" },
          refresh: { type: "boolean" },
          nodeRef: { type: "object" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request, context) => {
      const payload = asRecord(request.payload);
      const contextRequest: WorkbenchWebContextReadRequest = {
        ...(readString(payload.tabId) === undefined ? {} : { tabId: readString(payload.tabId) }),
        ...(readString(payload.regionId) === undefined ? {} : { regionId: readString(payload.regionId) }),
        ...(readString(payload.scope) === undefined
          ? {}
          : { scope: readString(payload.scope) as WorkbenchWebContextReadRequest["scope"] }),
        ...(readNumber(payload.maxNodes) === undefined ? {} : { maxNodes: readNumber(payload.maxNodes) }),
        ...(readString(payload.currentSubgoal) === undefined
          ? {}
          : { currentSubgoal: readString(payload.currentSubgoal) }),
        ...(readBoolean(payload.refresh) === undefined
          ? {}
          : { refresh: readBoolean(payload.refresh) }),
        ...((payload.nodeRef !== null && typeof payload.nodeRef === "object" && !Array.isArray(payload.nodeRef))
          ? { nodeRef: payload.nodeRef as WorkbenchWebContextReadRequest["nodeRef"] }
          : {})
      };
      return await webAutomationService.readContext(
        contextRequest,
        toWebAutomationCallContext(request, context)
      );
    }
  );

  registry.register(
    {
      id: "workbench.web_focus.probe",
      domain: "workbench",
      kind: "action",
      title: "Probe Web Focus Locally",
      appId: WORKBENCH_APP_ID,
      operation: "web_focus.probe",
      description: "Perform a local focus probe on the current page to validate keyboard reachability for a specific region or target.",
      permissions: ["workbench:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "string" },
          widgetId: { type: "string" },
          focusRegionId: { type: "string" },
          refresh: { type: "boolean" },
          target: { type: "object" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request, context) => {
      const payload = asRecord(request.payload);
      const probeRequest: WorkbenchWebFocusProbeRequest = {
        ...(readString(payload.tabId) === undefined ? {} : { tabId: readString(payload.tabId) }),
        ...(readString(payload.widgetId) === undefined ? {} : { widgetId: readString(payload.widgetId) }),
        ...(readString(payload.focusRegionId) === undefined
          ? {}
          : { focusRegionId: readString(payload.focusRegionId) }),
        ...(readBoolean(payload.refresh) === undefined
          ? {}
          : { refresh: readBoolean(payload.refresh) }),
        ...((payload.target !== null && typeof payload.target === "object" && !Array.isArray(payload.target))
          ? { target: payload.target as WorkbenchWebFocusProbeRequest["target"] }
          : {})
      };
      return await webAutomationService.probeFocus(
        probeRequest,
        toWebAutomationCallContext(request, context)
      );
    }
  );

  registry.register(
    {
      id: "workbench.web_scan_and_act",
      domain: "workbench",
      kind: "action",
      title: "Scan And Run Web Action",
      appId: WORKBENCH_APP_ID,
      operation: "web_scan_and_act",
      description: "Run one atomic local cycle: scan, choose the best human-operable candidate, execute action, and verify goal progress.",
      permissions: ["workbench:read", "workbench:write", "browser:navigate", "network:http"],
      risk: "write",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          tabId: { type: "string" },
          graphId: { type: "string" },
          action: { type: "object" },
          timeoutMs: { type: "number" },
          waitForNavigationMs: { type: "number" },
          scope: { type: "string", enum: ["visible", "nearby", "expanded"] },
          maxCandidates: { type: "number" },
          maxResults: { type: "number" },
          maxLatencyMs: { type: "number" },
          followThroughSteps: { type: "number", enum: [0, 1, 2] },
          goal: {
            type: "object",
            properties: {
              expectedTransitions: {
                type: "array",
                items: { type: "string" }
              },
              mustAdvance: { type: "boolean" }
            },
            additionalProperties: false
          },
          role: {
            oneOf: [
              { type: "string" },
              { type: "array", items: { type: "string" } }
            ]
          },
          name: { type: "string" },
          text: { type: "string" },
          textContains: { type: "string" },
          textSnippet: { type: "string" },
          ariaLabel: { type: "string" },
          label: { type: "string" },
          placeholder: { type: "string" },
          within: { type: "string" },
          near: { type: "string" },
          regionId: { type: "string" },
          groupId: { type: "string" },
          index: { type: "number" },
          state: {
            type: "object",
            properties: {
              checked: { type: "boolean" },
              selected: { type: "boolean" },
              expanded: { type: "boolean" },
              disabled: { type: "boolean" },
              invalid: { type: "boolean" },
              required: { type: "boolean" },
              readonly: { type: "boolean" },
              visible: { type: "boolean" }
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
      const actionInput = asRecord(payload.action);
      const actionKind = readString(actionInput.kind) ?? readString(actionInput.type);
      const actionTarget = asRecord(actionInput.target);
      const hasActionTarget = Object.keys(actionTarget).length > 0;
      const fallbackActionTarget = buildScanAndActFallbackTarget(payload, actionInput);
      const normalizedPayload = (
        actionKind !== undefined
        && hasActionTarget === false
        && (
          actionKind === "click"
          || actionKind === "hover"
          || actionKind === "focus"
          || actionKind === "scroll_into_view"
          || actionKind === "expand_probe"
          || actionKind === "submit_form"
          || actionKind === "open_link_node"
        )
        && Object.keys(fallbackActionTarget).length > 0
      )
        ? {
          ...payload,
          action: {
            ...actionInput,
            target: fallbackActionTarget
          }
        }
        : payload;
      let actionRequest: ReturnType<typeof parseWorkbenchWebActionRequestPayload>;
      try {
        actionRequest = parseWorkbenchWebActionRequestPayload(normalizedPayload);
      } catch (error) {
        const message =
          error instanceof Error && typeof error.message === "string"
            ? error.message
            : "";
        const allowsTargetlessScanAndAct =
          (
            actionKind === "click"
            || actionKind === "hover"
            || actionKind === "focus"
            || actionKind === "scroll_into_view"
            || actionKind === "expand_probe"
            || actionKind === "submit_form"
            || actionKind === "open_link_node"
          )
          && message.includes("requires target");
        if (!allowsTargetlessScanAndAct || actionKind === undefined) {
          throw error;
        }
        actionRequest = {
          ...(readString(normalizedPayload.tabId) === undefined
            ? {}
            : { tabId: readString(normalizedPayload.tabId) }),
          ...(readString(normalizedPayload.graphId) === undefined
            ? {}
            : { graphId: readString(normalizedPayload.graphId) }),
          action: {
            kind: actionKind as "click" | "hover" | "focus" | "scroll_into_view" | "expand_probe" | "submit_form" | "open_link_node",
            target: {}
          },
          ...(readNumber(normalizedPayload.timeoutMs) === undefined
            ? {}
            : { timeoutMs: readNumber(normalizedPayload.timeoutMs) }),
          ...(readNumber(normalizedPayload.waitForNavigationMs) === undefined
            ? {}
            : { waitForNavigationMs: readNumber(normalizedPayload.waitForNavigationMs) }),
        };
      }
      const roleHint =
        readString(payload.role)
        ?? readStringArray(payload.role)
        ?? readString(actionInput.role)
        ?? readStringArray(actionInput.role);
      const resolvedText =
        readString(payload.text)
        ?? readString(payload.textContains)
        ?? readString(payload.textSnippet)
        ?? readString(actionInput.text)
        ?? readString(actionInput.textContains)
        ?? readString(actionInput.textSnippet);
      const resolvedName =
        readString(payload.name)
        ?? readString(payload.ariaLabel)
        ?? readString(payload.label)
        ?? readString(payload.placeholder)
        ?? readString(actionInput.name)
        ?? readString(actionInput.ariaLabel)
        ?? readString(actionInput.label)
        ?? readString(actionInput.placeholder);
      const goalPayload = asRecord(payload.goal);
      const expectedTransitions = Array.isArray(goalPayload.expectedTransitions)
        ? goalPayload.expectedTransitions
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .map((entry) => entry.trim())
        : undefined;
      const resolvedWithin = readString(payload.within) ?? readString(actionInput.within);
      const resolvedNear = readString(payload.near) ?? readString(actionInput.near);
      const resolvedRegionId = readString(payload.regionId) ?? readString(actionInput.regionId);
      const resolvedGroupId = readString(payload.groupId) ?? readString(actionInput.groupId);
      const resolvedIndex = readNumber(payload.index) ?? readNumber(actionInput.index);
      const resolvedState = parseQueryStateFilter(payload.state) ?? parseQueryStateFilter(actionInput.state);
      const targetHints: WorkbenchWebScanAndActRequest["targetHints"] = {
        ...(roleHint === undefined ? {} : { role: roleHint }),
        ...(resolvedName === undefined ? {} : { name: resolvedName }),
        ...(resolvedText === undefined ? {} : { text: resolvedText }),
        ...(resolvedWithin === undefined ? {} : { within: resolvedWithin }),
        ...(resolvedNear === undefined ? {} : { near: resolvedNear }),
        ...(resolvedRegionId === undefined ? {} : { regionId: resolvedRegionId }),
        ...(resolvedGroupId === undefined ? {} : { groupId: resolvedGroupId }),
        ...(resolvedIndex === undefined ? {} : { index: resolvedIndex }),
        ...(resolvedState === undefined ? {} : { state: resolvedState })
      };
      const hasTargetHints = Object.keys(targetHints).length > 0;
      const followThroughSteps = readNumber(payload.followThroughSteps) ?? readNumber(actionInput.followThroughSteps);
      const resolvedScope =
        readString(payload.scope) ?? readString(actionInput.scope);
      const resolvedMaxCandidates =
        readNumber(payload.maxCandidates)
        ?? readNumber(payload.maxResults)
        ?? readNumber(actionInput.maxCandidates)
        ?? readNumber(actionInput.maxResults);
      const resolvedMaxLatencyMs = readNumber(payload.maxLatencyMs) ?? readNumber(actionInput.maxLatencyMs);
      const scanAndActRequest: WorkbenchWebScanAndActRequest = {
        ...actionRequest,
        ...(resolvedScope === undefined
          ? {}
          : { scope: resolvedScope as WorkbenchWebScanAndActRequest["scope"] }),
        ...(resolvedMaxCandidates === undefined
          ? {}
          : { maxCandidates: resolvedMaxCandidates }),
        ...(resolvedMaxLatencyMs === undefined
          ? {}
          : { maxLatencyMs: resolvedMaxLatencyMs }),
        ...(followThroughSteps === undefined
          ? {}
          : { followThroughSteps: Math.max(0, Math.min(2, Math.round(followThroughSteps))) as 0 | 1 | 2 }),
        ...(hasTargetHints ? { targetHints } : {}),
        ...(
          expectedTransitions !== undefined || readBoolean(goalPayload.mustAdvance) !== undefined
            ? {
              goal: {
                ...(expectedTransitions === undefined
                  ? {}
                  : {
                    expectedTransitions:
                      expectedTransitions as NonNullable<WorkbenchWebScanAndActRequest["goal"]>["expectedTransitions"]
                  }),
                ...(readBoolean(goalPayload.mustAdvance) === undefined
                  ? {}
                  : { mustAdvance: readBoolean(goalPayload.mustAdvance) })
              }
            }
            : {}
        )
      };
      return await webAutomationService.scanAndAct(
        scanAndActRequest,
        toWebAutomationCallContext(request, context)
      );
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
      if (
        actionRequest.action.kind === "focus"
        || actionRequest.action.kind === "hover"
        || actionRequest.action.kind === "scroll_into_view"
        || actionRequest.action.kind === "expand_probe"
      ) {
        return await webAutomationService.runSafeAction(
          actionRequest,
          toWebAutomationCallContext(request, context)
        );
      }
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
      "workbench.web_skeleton.read",
      "workbench.web_query.find",
      "workbench.web_context.read",
      "workbench.web_focus.probe",
      "workbench.web_scan_and_act",
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
