import { describe, expect, test, vi } from "vitest";

import type {
  WorkbenchDocumentInspectResult,
  WorkbenchDocumentReadResult,
  WorkbenchDocumentSearchResult
} from "../../../shared/workbench-documents";
import { registerDocumentCapabilities } from "../adapters/documents";
import { CapabilityRegistry } from "../registry";

const createDocumentService = () => {
  const inspectDocument = vi.fn(async (): Promise<WorkbenchDocumentInspectResult> => ({
    tabId: "browser-tab-1",
    documentId: "browser-tab-1:pdf",
    format: "pdf",
    sourceKind: "top_level",
    pageCount: 32,
    currentPageIndex: 32,
    visiblePageIndices: [32],
    textAvailable: true,
    encrypted: false,
    metadataSource: "pdf:rust-probe",
    fallbackUsed: false
  }));
  const readDocument = vi.fn(async (): Promise<WorkbenchDocumentReadResult> => ({
    tabId: "browser-tab-1",
    documentId: "browser-tab-1:pdf",
    format: "pdf",
    sourceKind: "top_level",
    scope: "full",
    text: "hello pdf",
    startChar: 0,
    endChar: 9,
    totalChars: 9,
    truncated: false,
    hasMore: false,
    extractionMethod: "pdf:rust-parser",
    fallbackUsed: false
  }));
  const searchDocument = vi.fn(async (): Promise<WorkbenchDocumentSearchResult> => ({
    tabId: "browser-tab-1",
    documentId: "browser-tab-1:pdf",
    format: "pdf",
    matches: [{ pageIndex: 1, excerpt: "hello pdf" }],
    truncated: false
  }));
  return {
    dispose: vi.fn(),
    detectActiveDocument: vi.fn(async () => null),
    inspectDocument,
    readDocument,
    searchDocument
  };
};

describe("document capability adapter", () => {
  test("invokes workbench.document.inspect through the documents service", async () => {
    const service = createDocumentService();
    const registry = new CapabilityRegistry(vi.fn());
    registerDocumentCapabilities(registry, service);

    const result = await registry.invoke({
      capabilityId: "workbench.document.inspect",
      payload: {
        tabId: "browser-tab-1"
      }
    });

    expect(result.ok).toBe(true);
    expect(service.inspectDocument).toHaveBeenCalledWith({
      tabId: "browser-tab-1"
    });
  });

  test("invokes workbench.document.read through the documents service", async () => {
    const service = createDocumentService();
    const registry = new CapabilityRegistry(vi.fn());
    registerDocumentCapabilities(registry, service);

    const result = await registry.invoke({
      capabilityId: "workbench.document.read",
      payload: {
        tabId: "browser-tab-1",
        scope: "current_page",
        maxChars: 2048
      }
    });

    expect(result.ok).toBe(true);
    expect(service.readDocument).toHaveBeenCalledWith({
      tabId: "browser-tab-1",
      scope: "current_page",
      maxChars: 2048
    });
  });

  test("invokes workbench.document.search through the documents service", async () => {
    const service = createDocumentService();
    const registry = new CapabilityRegistry(vi.fn());
    registerDocumentCapabilities(registry, service);

    const result = await registry.invoke({
      capabilityId: "workbench.document.search",
      payload: {
        query: "hello",
        maxMatches: 5
      }
    });

    expect(result.ok).toBe(true);
    expect(service.searchDocument).toHaveBeenCalledWith({
      query: "hello",
      maxMatches: 5
    });
  });
});
