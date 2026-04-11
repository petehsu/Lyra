import { describe, expect, test, vi } from "vitest";

import type { WorkbenchBrowserIpcBridge } from "../../workbench-browser/service";
import type {
  WorkbenchBrowserFrameDescriptor,
  WorkbenchBrowserFrameDomProbeResult,
  WorkbenchBrowserSessionFetchResult
} from "../../workbench-browser/types";
import { detectDocumentCandidates } from "../detector";

const createBrowserBridge = ({
  pageState,
  frames,
  probe
}: {
  readonly pageState: {
    readonly tabId: string;
    readonly address: string;
    readonly title: string;
    readonly isActive: boolean;
    readonly isVisible: boolean;
    readonly isLoading: boolean;
    readonly canGoBack: boolean;
    readonly canGoForward: boolean;
    readonly isHtmlFullscreen: boolean;
    readonly updatedAt: number;
  };
  readonly frames: readonly WorkbenchBrowserFrameDescriptor[];
  readonly probe: WorkbenchBrowserFrameDomProbeResult;
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
    readPageState: vi.fn(() => pageState),
    readActiveTabId: vi.fn(() => pageState.tabId),
    listFrames: vi.fn(() => frames),
    probeFrameDom: vi.fn(async () => probe),
    fetchWithTabSession: vi.fn(async (): Promise<WorkbenchBrowserSessionFetchResult> => {
      throw new Error("not used");
    }),
    readPageDomSummary: vi.fn(),
    extractPageText: vi.fn(),
    capturePage: vi.fn(),
    reapplyLayout: vi.fn(),
    toggleDevToolsForActivePage: vi.fn(() => false)
  }) as unknown as WorkbenchBrowserIpcBridge;

describe("detectDocumentCandidates", () => {
  test("detects top-level pdf frame URLs as parser-backed document candidates", async () => {
    const tabId = "browser-tab-1";
    const browserBridge = createBrowserBridge({
      pageState: {
        tabId,
        address: "https://example.com/file.pdf",
        title: "file.pdf",
        isActive: true,
        isVisible: true,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        isHtmlFullscreen: false,
        updatedAt: Date.now()
      },
      frames: [
        {
          frameTreeNodeId: 1,
          url: "https://example.com/file.pdf",
          origin: "https://example.com",
          name: "",
          isMainFrame: true
        }
      ],
      probe: {
        embeddedDocuments: []
      }
    });

    const candidates = await detectDocumentCandidates({ browserBridge, tabId });

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKind: "top_level",
          formatHint: "pdf",
          documentUrl: "https://example.com/file.pdf"
        })
      ])
    );
  });

  test("upgrades pdfjs viewer candidates to parser-backed pdfs using embedded document URLs", async () => {
    const tabId = "browser-tab-9";
    const browserBridge = createBrowserBridge({
      pageState: {
        tabId,
        address: "https://example.com/viewer",
        title: "Viewer",
        isActive: true,
        isVisible: true,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        isHtmlFullscreen: false,
        updatedAt: Date.now()
      },
      frames: [
        {
          frameTreeNodeId: 10,
          url: "https://example.com/viewer",
          origin: "https://example.com",
          name: "",
          isMainFrame: true
        }
      ],
      probe: {
        title: "Embedded PDF",
        viewerKind: "pdfjs",
        viewerDocumentUrl: "/records/17826516/files/LyraLife_Paper.pdf?preview=0",
        currentPageIndex: 4,
        pageCount: 12,
        visiblePageIndices: [4, 5],
        embeddedDocuments: [
          {
            sourceKind: "embed",
            documentUrl: "https://cdn.example.com/private/doc?id=7",
            mimeHint: "application/pdf",
            formatHint: "pdf",
            visibleRatio: 0.9,
            titleHint: "Embedded PDF"
          }
        ]
      }
    });

    const candidates = await detectDocumentCandidates({ browserBridge, tabId });
    const viewerCandidate = candidates.find((candidate) => candidate.sourceKind === "viewer_dom");

    expect(viewerCandidate).toMatchObject({
      formatHint: "pdf",
      documentUrl: "https://example.com/records/17826516/files/LyraLife_Paper.pdf?preview=0",
      mimeHint: "application/pdf",
      currentPageIndex: 4,
      pageCountHint: 12,
      visiblePageIndices: [4, 5]
    });
  });

  test("uses pdfjs hidden viewer document urls when no embedded iframe/object candidate exists", async () => {
    const tabId = "browser-tab-10";
    const browserBridge = createBrowserBridge({
      pageState: {
        tabId,
        address: "https://zenodo.org/records/17826516/preview/LyraLife_Paper.pdf?include_deleted=0",
        title: "Preview",
        isActive: true,
        isVisible: true,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        isHtmlFullscreen: false,
        updatedAt: Date.now()
      },
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
        viewerDocumentUrl: "/records/17826516/files/LyraLife_Paper.pdf?preview=0",
        embeddedDocuments: []
      }
    });

    const candidates = await detectDocumentCandidates({ browserBridge, tabId });
    const viewerCandidate = candidates.find((candidate) => candidate.sourceKind === "viewer_dom");

    expect(viewerCandidate).toMatchObject({
      formatHint: "pdf",
      documentUrl: "https://zenodo.org/records/17826516/files/LyraLife_Paper.pdf?preview=0",
      mimeHint: "application/pdf"
    });
  });
});
