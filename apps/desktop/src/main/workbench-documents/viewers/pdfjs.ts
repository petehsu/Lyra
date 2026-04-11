import type { WorkbenchBrowserFrameDomProbeResult } from "../../workbench-browser/types";
import type { DocumentFallbackResult } from "../types";

export const readPdfJsFallback = ({
  probe,
  cursor,
  maxChars
}: {
  readonly probe: WorkbenchBrowserFrameDomProbeResult;
  readonly cursor: number;
  readonly maxChars: number;
}): DocumentFallbackResult | null => {
  const source = probe.viewerText ?? probe.containerText ?? probe.bodyText;
  if (typeof source !== "string" || source.trim().length === 0) {
    return null;
  }
  const text = source.slice(cursor, cursor + maxChars);
  return {
    text,
    ...(probe.currentPageIndex === undefined ? {} : { currentPageIndex: probe.currentPageIndex }),
    ...(probe.visiblePageIndices === undefined ? {} : { visiblePageIndices: probe.visiblePageIndices }),
    ...(probe.pageCount === undefined ? {} : { pageCount: probe.pageCount }),
    extractionMethod:
      probe.viewerText !== undefined
        ? "viewer:frame-dom"
        : probe.containerText !== undefined
          ? "viewer:container-dom"
          : "viewer:visible-dom",
    fallbackReason: "pdfjs-viewer-dom"
  };
};
