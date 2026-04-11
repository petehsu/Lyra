import type { WorkbenchEmbeddedDocumentCandidate } from "../../shared/workbench-documents";
import type { CachedDocumentBytes, ResolvedDocumentTarget } from "./types";

const MAX_PREFIX_CHARS = 160;

const readUtf8Prefix = (body: Buffer): string =>
  body.subarray(0, Math.min(body.length, 512)).toString("utf8").slice(0, MAX_PREFIX_CHARS).trim();

export const sniffDocumentContent = (
  body: Buffer
): {
  readonly contentSignature: "pdf_header" | "html_doctype" | "html_tag" | "unknown";
  readonly textPrefix?: string;
} => {
  if (body.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    return { contentSignature: "pdf_header" };
  }
  const prefix = readUtf8Prefix(body);
  const lower = prefix.toLowerCase();
  if (lower.startsWith("<!doctype html")) {
    return {
      contentSignature: "html_doctype",
      ...(prefix.length === 0 ? {} : { textPrefix: prefix })
    };
  }
  if (lower.startsWith("<html") || lower.includes("<html")) {
    return {
      contentSignature: "html_tag",
      ...(prefix.length === 0 ? {} : { textPrefix: prefix })
    };
  }
  return {
    contentSignature: "unknown",
    ...(prefix.length === 0 ? {} : { textPrefix: prefix })
  };
};

const serializeCandidate = (candidate: WorkbenchEmbeddedDocumentCandidate) => ({
  candidateId: candidate.candidateId,
  sourceKind: candidate.sourceKind,
  formatHint: candidate.formatHint,
  ...(candidate.frameTreeNodeId === undefined ? {} : { frameTreeNodeId: candidate.frameTreeNodeId }),
  ...(candidate.frameUrl === undefined ? {} : { frameUrl: candidate.frameUrl }),
  ...(candidate.documentUrl === undefined ? {} : { documentUrl: candidate.documentUrl }),
  ...(candidate.mimeHint === undefined ? {} : { mimeHint: candidate.mimeHint }),
  visibleRatio: candidate.visibleRatio,
  ...(candidate.titleHint === undefined ? {} : { titleHint: candidate.titleHint }),
  ...(candidate.currentPageIndex === undefined ? {} : { currentPageIndex: candidate.currentPageIndex }),
  ...(candidate.visiblePageIndices === undefined ? {} : { visiblePageIndices: candidate.visiblePageIndices }),
  ...(candidate.pageCountHint === undefined ? {} : { pageCountHint: candidate.pageCountHint })
});

const likelyCauseForContent = (contentSignature: "pdf_header" | "html_doctype" | "html_tag" | "unknown"): string | undefined => {
  if (contentSignature === "html_doctype" || contentSignature === "html_tag") {
    return "resolved_document_url_returned_html_wrapper_instead_of_pdf_bytes";
  }
  return undefined;
};

export const buildDocumentDiagnostics = ({
  stage,
  target,
  fetch,
  request,
  causeCode
}: {
  readonly stage: "resolve" | "fetch" | "parse" | "fallback";
  readonly target: ResolvedDocumentTarget;
  readonly fetch?: CachedDocumentBytes;
  readonly request?: Record<string, unknown>;
  readonly causeCode?: string;
}): Record<string, unknown> => {
  const sniffed = fetch === undefined ? undefined : sniffDocumentContent(fetch.body);
  return {
    domain: "workbench.document",
    stage,
    tabId: target.tabId,
    candidate: serializeCandidate(target.candidate),
    ...(request === undefined ? {} : { request }),
    ...(causeCode === undefined ? {} : { causeCode }),
    ...(fetch === undefined
      ? {}
      : {
          fetch: {
            finalUrl: fetch.finalUrl,
            ...(fetch.mimeType === undefined ? {} : { mimeType: fetch.mimeType }),
            byteLength: fetch.body.length,
            ...sniffed,
            ...(sniffed === undefined
              ? {}
              : likelyCauseForContent(sniffed.contentSignature) === undefined
                ? {}
                : { likelyCause: likelyCauseForContent(sniffed.contentSignature) })
          }
        })
  };
};

export const createDocumentServiceError = ({
  code,
  message,
  details
}: {
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;
}): Error =>
  Object.assign(new Error(message), {
    code,
    details
  });
