import type { LyraAppManifest } from "@lyra/capability-protocol";

import type {
  WorkbenchDocumentInspectRequest,
  WorkbenchDocumentReadRequest,
  WorkbenchDocumentSearchRequest
} from "../../../shared/workbench-documents";
import type { WorkbenchDocumentsService } from "../../workbench-documents/types";
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

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const registerDocumentCapabilities = (
  registry: CapabilityRegistry,
  documentsService: WorkbenchDocumentsService
): LyraAppManifest => {
  registry.register(
    {
      id: "workbench.document.inspect",
      domain: "workbench",
      kind: "resource",
      title: "Inspect Active Workbench Document",
      appId: WORKBENCH_APP_ID,
      operation: "document.inspect",
      description: "Inspect the active PDF or embedded document metadata from the current browser tab, including page count, current page, and visible pages when available.",
      permissions: ["workbench:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: { type: "object" }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const tabId = readString(payload.tabId);
      const nextRequest: WorkbenchDocumentInspectRequest = {
        ...(tabId === undefined ? {} : { tabId })
      };
      return await documentsService.inspectDocument(nextRequest);
    }
  );

  registry.register(
    {
      id: "workbench.document.read",
      domain: "workbench",
      kind: "resource",
      title: "Read Active Workbench Document",
      appId: WORKBENCH_APP_ID,
      operation: "document.read",
      description: "Read the active PDF or embedded document content from the current browser tab.",
      permissions: ["workbench:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "string" },
          scope: {
            type: "string",
            enum: ["full", "current_page", "visible", "page_range"]
          },
          pageStart: { type: "number" },
          pageEnd: { type: "number" },
          maxChars: { type: "number" },
          cursor: { type: "number" }
        },
        additionalProperties: false
      },
      outputSchema: { type: "object" }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const tabId = readString(payload.tabId);
      const scope = readString(payload.scope) as WorkbenchDocumentReadRequest["scope"] | undefined;
      const pageStart = readNumber(payload.pageStart);
      const pageEnd = readNumber(payload.pageEnd);
      const maxChars = readNumber(payload.maxChars);
      const cursor = readNumber(payload.cursor);
      const nextRequest: WorkbenchDocumentReadRequest = {
        ...(tabId === undefined ? {} : { tabId }),
        ...(scope === undefined ? {} : { scope }),
        ...(pageStart === undefined ? {} : { pageStart }),
        ...(pageEnd === undefined ? {} : { pageEnd }),
        ...(maxChars === undefined ? {} : { maxChars }),
        ...(cursor === undefined ? {} : { cursor })
      };
      return await documentsService.readDocument(nextRequest);
    }
  );

  registry.register(
    {
      id: "workbench.document.search",
      domain: "workbench",
      kind: "resource",
      title: "Search Active Workbench Document",
      appId: WORKBENCH_APP_ID,
      operation: "document.search",
      description: "Search within the active PDF or embedded document content from the current browser tab.",
      permissions: ["workbench:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          tabId: { type: "string" },
          query: { type: "string" },
          maxMatches: { type: "number" }
        },
        additionalProperties: false
      },
      outputSchema: { type: "object" }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const query = readString(payload.query);
      if (query === undefined) {
        throw new Error("query is required");
      }
      const tabId = readString(payload.tabId);
      const maxMatches = readNumber(payload.maxMatches);
      const nextRequest: WorkbenchDocumentSearchRequest = {
        query,
        ...(tabId === undefined ? {} : { tabId }),
        ...(maxMatches === undefined ? {} : { maxMatches })
      };
      return await documentsService.searchDocument(nextRequest);
    }
  );

  return {
    id: WORKBENCH_APP_ID,
    title: "Workbench",
    version: "1.0.0",
    source: "builtin",
    description: "Lyra workbench document observation capabilities.",
    permissions: ["workbench:read"],
    capabilities: ["workbench.document.inspect", "workbench.document.read", "workbench.document.search"],
    compatibility: {},
    contributes: { surfaces: ["workspace"] }
  };
};
