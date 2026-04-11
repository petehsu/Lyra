import type { WorkbenchEmbeddedDocumentCandidate } from "../../shared/workbench-documents";
import type { WorkbenchBrowserFrameDescriptor } from "../workbench-browser/types";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import { normalizeDocumentUrl } from "./fetch";

const formatHintFrom = (value: string | undefined): WorkbenchEmbeddedDocumentCandidate["formatHint"] => {
  const lower = value?.toLowerCase() ?? "";
  return lower.includes("application/pdf") || lower.endsWith(".pdf") || lower.includes(".pdf?")
    ? "pdf"
    : "unknown";
};

const candidateId = (tabId: string, sourceKind: string, frameTreeNodeId?: number, documentUrl?: string): string =>
  [tabId, sourceKind, frameTreeNodeId ?? "none", documentUrl ?? "no-url"].join(":");

const attachFrameId = (
  frames: readonly WorkbenchBrowserFrameDescriptor[],
  url: string | undefined
): number | undefined => {
  if (typeof url !== "string" || url.length === 0) {
    return undefined;
  }
  return frames.find((frame) => frame.url === url)?.frameTreeNodeId;
};

const bestEmbeddedPdf = (
  candidates: readonly {
    readonly documentUrl?: string;
    readonly mimeHint?: string;
    readonly formatHint: "pdf" | "unknown";
    readonly visibleRatio: number;
    readonly titleHint?: string;
  }[]
) =>
  [...candidates]
    .filter((candidate) => candidate.formatHint === "pdf")
    .sort((left, right) => right.visibleRatio - left.visibleRatio)[0];

export const detectDocumentCandidates = async ({
  browserBridge,
  tabId
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly tabId: string;
}): Promise<readonly WorkbenchEmbeddedDocumentCandidate[]> => {
  const runtimeState = browserBridge.readPageState({ tabId });
  if (runtimeState === null) {
    return [];
  }

  const frames = browserBridge.listFrames(tabId);
  const candidates: WorkbenchEmbeddedDocumentCandidate[] = [];
  const seen = new Set<string>();

  const push = (candidate: WorkbenchEmbeddedDocumentCandidate): void => {
    if (seen.has(candidate.candidateId)) {
      return;
    }
    seen.add(candidate.candidateId);
    candidates.push(candidate);
  };

  for (const frame of frames) {
    const directUrl = normalizeDocumentUrl(frame.url);
    const directFormat = formatHintFrom(frame.url);
    if (directFormat === "pdf" && directUrl !== null) {
      push({
        candidateId: candidateId(tabId, frame.isMainFrame ? "top_level" : "iframe", frame.frameTreeNodeId, directUrl),
        tabId,
        sourceKind: frame.isMainFrame ? "top_level" : "iframe",
        frameTreeNodeId: frame.frameTreeNodeId,
        frameUrl: frame.url,
        documentUrl: directUrl,
        formatHint: "pdf",
        visibleRatio: frame.isMainFrame ? (runtimeState.isVisible ? 1 : 0.8) : 0.9
      });
    }

    const probe = await browserBridge.probeFrameDom(tabId, frame.frameTreeNodeId, {
      maxChars: 12_000
    });
    const embeddedPdf = bestEmbeddedPdf(probe.embeddedDocuments);
    const viewerPdfUrl = probe.viewerDocumentUrl === undefined
      ? undefined
      : normalizeDocumentUrl(probe.viewerDocumentUrl, frame.url) ?? undefined;
    const embeddedPdfUrl = embeddedPdf?.documentUrl === undefined
      ? undefined
      : normalizeDocumentUrl(embeddedPdf.documentUrl, frame.url) ?? undefined;

    if (probe.viewerKind === "pdfjs") {
      push({
        candidateId: candidateId(tabId, "viewer_dom", frame.frameTreeNodeId, frame.url),
        tabId,
        sourceKind: "viewer_dom",
        frameTreeNodeId: frame.frameTreeNodeId,
        frameUrl: frame.url,
        ...(viewerPdfUrl !== undefined
          ? { documentUrl: viewerPdfUrl }
          : embeddedPdfUrl === undefined
          ? directUrl === null
            ? {}
            : { documentUrl: directUrl }
          : { documentUrl: embeddedPdfUrl }),
        ...(embeddedPdf?.mimeHint === undefined ? { mimeHint: "application/pdf" } : { mimeHint: embeddedPdf.mimeHint }),
        formatHint: directFormat === "pdf" || embeddedPdf !== undefined || viewerPdfUrl !== undefined ? "pdf" : "unknown",
        visibleRatio: frame.isMainFrame ? (runtimeState.isVisible ? 1 : 0.8) : 0.95,
        ...(probe.title === undefined
          ? embeddedPdf?.titleHint === undefined
            ? {}
            : { titleHint: embeddedPdf.titleHint }
          : { titleHint: probe.title }),
        ...(probe.currentPageIndex === undefined ? {} : { currentPageIndex: probe.currentPageIndex }),
        ...(probe.visiblePageIndices === undefined ? {} : { visiblePageIndices: probe.visiblePageIndices }),
        ...(probe.pageCount === undefined ? {} : { pageCountHint: probe.pageCount })
      });
    }

    for (const embedded of probe.embeddedDocuments) {
      const documentUrl = embedded.documentUrl === undefined
        ? undefined
        : normalizeDocumentUrl(embedded.documentUrl, frame.url) ?? undefined;
      const embeddedFrameTreeNodeId = attachFrameId(frames, documentUrl);
      push({
        candidateId: candidateId(tabId, embedded.sourceKind, embeddedFrameTreeNodeId, documentUrl),
        tabId,
        sourceKind: embedded.sourceKind,
        ...(embeddedFrameTreeNodeId === undefined ? {} : { frameTreeNodeId: embeddedFrameTreeNodeId }),
        frameUrl: frame.url,
        ...(documentUrl === undefined ? {} : { documentUrl }),
        ...(embedded.mimeHint === undefined ? {} : { mimeHint: embedded.mimeHint }),
        formatHint: embedded.formatHint,
        visibleRatio: embedded.visibleRatio,
        ...(embedded.titleHint === undefined ? {} : { titleHint: embedded.titleHint })
      });
    }
  }

  return candidates;
};
