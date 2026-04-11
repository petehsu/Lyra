import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import type { WorkbenchDocumentSearchResult } from "../../shared/workbench-documents";
import { readGenericViewerFallback } from "./viewers/generic";
import { readPdfJsFallback } from "./viewers/pdfjs";
import type { DocumentFallbackResult, ResolvedDocumentTarget } from "./types";

const buildSearchMatches = (text: string, query: string, maxMatches: number): WorkbenchDocumentSearchResult["matches"] => {
  const lowerHaystack = text.toLocaleLowerCase();
  const lowerNeedle = query.trim().toLocaleLowerCase();
  if (lowerNeedle.length === 0) {
    return [];
  }
  const matches: Array<WorkbenchDocumentSearchResult["matches"][number]> = [];
  let cursor = 0;
  while (matches.length < maxMatches) {
    const next = lowerHaystack.indexOf(lowerNeedle, cursor);
    if (next < 0) {
      break;
    }
    const end = next + lowerNeedle.length;
    const excerpt = text.slice(Math.max(0, next - 120), Math.min(text.length, end + 120));
    matches.push({ excerpt, startChar: next, endChar: end });
    cursor = end;
  }
  return matches;
};

export const readDocumentFallback = async ({
  browserBridge,
  target,
  cursor,
  maxChars
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly target: ResolvedDocumentTarget;
  readonly cursor: number;
  readonly maxChars: number;
}): Promise<DocumentFallbackResult | null> => {
  if (target.candidate.frameTreeNodeId === undefined) {
    return null;
  }
  const probe = await browserBridge.probeFrameDom(target.tabId, target.candidate.frameTreeNodeId, {
    maxChars: cursor + maxChars
  });
  if (probe.viewerKind === "pdfjs") {
    return readPdfJsFallback({ probe, cursor, maxChars });
  }
  return readGenericViewerFallback({ probe, cursor, maxChars });
};

export const searchFallbackDocument = async ({
  browserBridge,
  target,
  query,
  maxMatches
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly target: ResolvedDocumentTarget;
  readonly query: string;
  readonly maxMatches: number;
}): Promise<WorkbenchDocumentSearchResult["matches"]> => {
  const fallback = await readDocumentFallback({
    browserBridge,
    target,
    cursor: 0,
    maxChars: 40_000
  });
  if (fallback === null) {
    return [];
  }
  return buildSearchMatches(fallback.text, query, maxMatches);
};
