import type { WorkbenchEmbeddedDocumentCandidate } from "../../shared/workbench-documents";
import type { WorkbenchBrowserFrameDescriptor } from "../workbench-browser/types";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import { normalizeDocumentUrl } from "./fetch";

const formatHintFrom = (value: string | undefined): WorkbenchEmbeddedDocumentCandidate["formatHint"] => {
  const lower = value?.toLowerCase() ?? "";
  if (lower.includes("application/pdf") || lower.endsWith(".pdf") || lower.includes(".pdf?")) {
    return "pdf";
  }
  if (lower.includes("wordprocessingml.document") || lower.endsWith(".docx") || lower.includes(".docx?")) {
    return "docx";
  }
  if (lower.includes("spreadsheetml.sheet") || lower.endsWith(".xlsx") || lower.includes(".xlsx?")) {
    return "xlsx";
  }
  if (lower.includes("presentationml.presentation") || lower.endsWith(".pptx") || lower.includes(".pptx?")) {
    return "pptx";
  }
  if (lower.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|tiff?|svg)(\?|#|$)/.test(lower)) {
    return "image";
  }
  return "unknown";
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

const bestEmbeddedDocument = (
  candidates: readonly {
    readonly documentUrl?: string;
    readonly mimeHint?: string;
    readonly formatHint: WorkbenchEmbeddedDocumentCandidate["formatHint"];
    readonly visibleRatio: number;
    readonly titleHint?: string;
  }[]
) =>
  [...candidates]
    .filter((candidate) => candidate.formatHint !== "unknown")
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
    if (directFormat !== "unknown" && directUrl !== null) {
      push({
        candidateId: candidateId(tabId, frame.isMainFrame ? "top_level" : "iframe", frame.frameTreeNodeId, directUrl),
        tabId,
        sourceKind: frame.isMainFrame ? "top_level" : "iframe",
        frameTreeNodeId: frame.frameTreeNodeId,
        frameUrl: frame.url,
        documentUrl: directUrl,
        formatHint: directFormat,
        visibleRatio: frame.isMainFrame ? (runtimeState.isVisible ? 1 : 0.8) : 0.9
      });
    }

    const probe = await browserBridge.probeFrameDom(tabId, frame.frameTreeNodeId, {
      maxChars: 12_000
    });
    const embeddedDocument = bestEmbeddedDocument(probe.embeddedDocuments);
    const viewerPdfUrl = probe.viewerDocumentUrl === undefined
      ? undefined
      : normalizeDocumentUrl(probe.viewerDocumentUrl, frame.url) ?? undefined;
    const embeddedDocumentUrl = embeddedDocument?.documentUrl === undefined
      ? undefined
      : normalizeDocumentUrl(embeddedDocument.documentUrl, frame.url) ?? undefined;

    if (probe.viewerKind === "pdfjs") {
      push({
        candidateId: candidateId(tabId, "viewer_dom", frame.frameTreeNodeId, frame.url),
        tabId,
        sourceKind: "viewer_dom",
        frameTreeNodeId: frame.frameTreeNodeId,
        frameUrl: frame.url,
        ...(viewerPdfUrl !== undefined
          ? { documentUrl: viewerPdfUrl }
          : embeddedDocumentUrl === undefined
          ? directUrl === null
            ? {}
            : { documentUrl: directUrl }
          : { documentUrl: embeddedDocumentUrl }),
        ...(embeddedDocument?.mimeHint === undefined ? { mimeHint: "application/pdf" } : { mimeHint: embeddedDocument.mimeHint }),
        formatHint: directFormat === "pdf" || embeddedDocument?.formatHint === "pdf" || viewerPdfUrl !== undefined ? "pdf" : "unknown",
        visibleRatio: frame.isMainFrame ? (runtimeState.isVisible ? 1 : 0.8) : 0.95,
        ...(probe.title === undefined
          ? embeddedDocument?.titleHint === undefined
            ? {}
            : { titleHint: embeddedDocument.titleHint }
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
