import { describe, expect, test, vi } from "vitest";

import type { DocsNativeBindings } from "../../documents/types";
import type { WorkbenchBrowserIpcBridge } from "../../workbench-browser/service";
import type {
  WorkbenchBrowserFrameDescriptor,
  WorkbenchBrowserFrameDomProbeResult,
  WorkbenchBrowserSessionFetchResult
} from "../../workbench-browser/types";
import { createWorkbenchDocumentsService } from "../service";

const createBrowserBridge = ({
  activeTabId = "browser-tab-1",
  pageStateAddress = "https://example.com/viewer",
  frames = [
    {
      frameTreeNodeId: 1,
      url: "https://example.com/viewer",
      origin: "https://example.com",
      name: "",
      isMainFrame: true
    }
  ],
  probe,
  fetchResult
}: {
  readonly activeTabId?: string;
  readonly pageStateAddress?: string;
  readonly frames?: readonly WorkbenchBrowserFrameDescriptor[];
  readonly probe: WorkbenchBrowserFrameDomProbeResult;
  readonly fetchResult?: WorkbenchBrowserSessionFetchResult;
}): WorkbenchBrowserIpcBridge =>
  ({
    dispose: vi.fn(),
    syncTopology: vi.fn(),
    syncLayout: vi.fn(),
    navigate: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    readPageState: vi.fn(() => ({
      tabId: activeTabId,
      address: pageStateAddress,
      title: "Document Viewer",
      isActive: true,
      isVisible: true,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      isHtmlFullscreen: false,
      updatedAt: Date.now()
    })),
    readActiveTabId: vi.fn(() => activeTabId),
    listFrames: vi.fn(() => frames),
    probeFrameDom: vi.fn(async () => probe),
    fetchWithTabSession: vi.fn(async () => {
      if (fetchResult === undefined) {
        throw new Error("fetch not configured");
      }
      return fetchResult;
    }),
    readPageDomSummary: vi.fn(),
    extractPageText: vi.fn(),
    capturePage: vi.fn(),
    reapplyLayout: vi.fn(),
    toggleDevToolsForActivePage: vi.fn(() => false)
  }) as unknown as WorkbenchBrowserIpcBridge;

const createDocsBindings = ({
  readResult,
  readError,
  searchResult
}: {
  readonly readResult?: Record<string, unknown>;
  readonly readError?: string;
  readonly searchResult?: Record<string, unknown>;
}): DocsNativeBindings => ({
  probeDocumentJson: vi.fn(() =>
    JSON.stringify({ format: "pdf", encrypted: false, textAvailable: true, pageCount: 12 })
  ),
  readDocumentTextJson: vi.fn((input) => {
    if (readError !== undefined) {
      throw new Error(readError);
    }
    if (readResult === undefined) {
      throw new Error("unexpected read");
    }
    return JSON.stringify({
      format: "pdf",
      text: "",
      startChar: 0,
      endChar: 0,
      totalChars: 0,
      truncated: false,
      hasMore: false,
      extractionMethod: "pdf:rust-parser",
      ...readResult,
      _request: JSON.parse(input)
    });
  }),
  searchDocumentTextJson: vi.fn((input) => {
    if (searchResult === undefined) {
      throw new Error("unexpected search");
    }
    return JSON.stringify({
      format: "pdf",
      matches: [],
      truncated: false,
      ...searchResult,
      _request: JSON.parse(input)
    });
  })
});

describe("workbench document service", () => {
  test("inspects parser-backed PDF metadata and returns page count from the rust probe", async () => {
    const browserBridge = createBrowserBridge({
      probe: {
        viewerKind: "pdfjs",
        viewerDocumentUrl: "/records/17826516/files/LyraLife_Paper.pdf?preview=0",
        currentPageIndex: 32,
        visiblePageIndices: [32],
        embeddedDocuments: []
      },
      fetchResult: {
        finalUrl: "https://example.com/records/17826516/files/LyraLife_Paper.pdf?preview=0",
        status: 200,
        mimeType: "application/pdf",
        body: Buffer.from("%PDF-mock")
      }
    });
    const docsBindings = createDocsBindings({});

    const service = createWorkbenchDocumentsService({
      browserBridge,
      docsNativeBindings: docsBindings
    });

    const result = await service.inspectDocument({});

    expect(result).toMatchObject({
      tabId: "browser-tab-1",
      format: "pdf",
      sourceKind: "viewer_dom",
      sourceUrl: "https://example.com/records/17826516/files/LyraLife_Paper.pdf?preview=0",
      mimeType: "application/pdf",
      pageCount: 12,
      currentPageIndex: 32,
      visiblePageIndices: [32],
      textAvailable: true,
      encrypted: false,
      metadataSource: "pdf:rust-probe",
      fallbackUsed: false
    });
  });

  test("reads parser-backed PDF content from pdfjs viewer document urls on the active browser tab", async () => {
    const browserBridge = createBrowserBridge({
      probe: {
        viewerKind: "pdfjs",
        viewerDocumentUrl: "/records/17826516/files/LyraLife_Paper.pdf?preview=0",
        embeddedDocuments: []
      },
      fetchResult: {
        finalUrl: "https://example.com/records/17826516/files/LyraLife_Paper.pdf?preview=0",
        status: 200,
        mimeType: "application/pdf",
        body: Buffer.from("%PDF-mock")
      }
    });
    const docsBindings = createDocsBindings({
      readResult: {
        format: "pdf",
        text: "Parsed PDF body",
        startChar: 0,
        endChar: 15,
        totalChars: 15,
        truncated: false,
        hasMore: false,
        pageCount: 12
      }
    });

    const service = createWorkbenchDocumentsService({
      browserBridge,
      docsNativeBindings: docsBindings
    });

    const result = await service.readDocument({});

    expect(result).toMatchObject({
      tabId: "browser-tab-1",
      format: "pdf",
      sourceKind: "viewer_dom",
      sourceUrl: "https://example.com/records/17826516/files/LyraLife_Paper.pdf?preview=0",
      mimeType: "application/pdf",
      text: "Parsed PDF body",
      extractionMethod: "pdf:rust-parser",
      fallbackUsed: false
    });
    expect(browserBridge.fetchWithTabSession).toHaveBeenCalledWith("browser-tab-1", expect.objectContaining({
      url: "https://example.com/records/17826516/files/LyraLife_Paper.pdf?preview=0"
    }));
  });

  test("falls back to viewer DOM text when no fetchable parser source exists", async () => {
    const browserBridge = createBrowserBridge({
      probe: {
        viewerKind: "pdfjs",
        viewerText: "Visible viewer text",
        currentPageIndex: 2,
        pageCount: 5,
        visiblePageIndices: [2],
        embeddedDocuments: []
      }
    });
    const docsBindings = createDocsBindings({});
    const service = createWorkbenchDocumentsService({
      browserBridge,
      docsNativeBindings: docsBindings
    });

    const result = await service.readDocument({});

    expect(result).toMatchObject({
      format: "unknown",
      extractionMethod: "viewer:frame-dom",
      fallbackUsed: true,
      currentPageIndex: 2,
      visiblePageIndices: [2],
      pageCount: 5,
      text: "Visible viewer text"
    });
  });

  test("inspects viewer metadata when no parser-backed source is available", async () => {
    const browserBridge = createBrowserBridge({
      probe: {
        viewerKind: "pdfjs",
        currentPageIndex: 2,
        pageCount: 5,
        visiblePageIndices: [2],
        embeddedDocuments: []
      }
    });
    const docsBindings = createDocsBindings({});
    const service = createWorkbenchDocumentsService({
      browserBridge,
      docsNativeBindings: docsBindings
    });

    const result = await service.inspectDocument({});

    expect(result).toMatchObject({
      format: "unknown",
      currentPageIndex: 2,
      visiblePageIndices: [2],
      pageCount: 5,
      metadataSource: "viewer:frame-dom",
      fallbackUsed: true
    });
  });

  test("searches fallback viewer text when parser-backed search is unavailable", async () => {
    const browserBridge = createBrowserBridge({
      probe: {
        viewerKind: "pdfjs",
        viewerText: "Alpha beta gamma beta delta",
        embeddedDocuments: []
      }
    });
    const docsBindings = createDocsBindings({});
    const service = createWorkbenchDocumentsService({
      browserBridge,
      docsNativeBindings: docsBindings
    });

    const result = await service.searchDocument({ query: "beta", maxMatches: 2 });

    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]?.excerpt.toLowerCase()).toContain("beta");
  });

  test("returns a plain document error when the resolved document url yields html instead of pdf bytes", async () => {
    const browserBridge = createBrowserBridge({
      pageStateAddress: "https://zenodo.org/records/17826516?_wv=1",
      frames: [
        {
          frameTreeNodeId: 11,
          url: "https://zenodo.org/records/17826516/preview/LyraLife_Paper.pdf?include_deleted=0",
          origin: "https://zenodo.org",
          name: "",
          isMainFrame: false
        }
      ],
      probe: {
        viewerKind: "pdfjs",
        viewerDocumentUrl: "/records/17826516/preview/LyraLife_Paper.pdf?include_deleted=0",
        embeddedDocuments: []
      },
      fetchResult: {
        finalUrl: "https://zenodo.org/records/17826516/preview/LyraLife_Paper.pdf?include_deleted=0",
        status: 200,
        mimeType: "text/html; charset=utf-8",
        body: Buffer.from("<!DOCTYPE html><html><head><title>Preview</title></head><body></body></html>")
      }
    });
    const docsBindings = createDocsBindings({
      readError: "DOCS_ERROR::document_unsupported_format::document format is unsupported"
    });
    const service = createWorkbenchDocumentsService({
      browserBridge,
      docsNativeBindings: docsBindings
    });

    await expect(service.readDocument({})).rejects.toMatchObject({
      code: "document_unsupported_format",
      message: "document format is unsupported"
    });
  });
});
