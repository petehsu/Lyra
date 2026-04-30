import type { LyraAppManifest } from "@lyra/capability-protocol";

import type {
  WorkbenchTabExtractTextRequest,
  WorkbenchTabReadRequest,
  WorkbenchTabsListRequest,
  WorkbenchVisualCaptureRequest,
  WorkbenchWorkspaceReadRequest
} from "../../../shared/workbench-observation";
import type { WorkbenchObservationService } from "../../workbench-observation/types";
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
  observationService: WorkbenchObservationService
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
      "workbench.tab.capture_visual"
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
