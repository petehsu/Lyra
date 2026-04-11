import type { WorkbenchBrowserFrameDomProbeResult } from "../../workbench-browser/types";
import type { DocumentFallbackResult } from "../types";

export const readGenericViewerFallback = ({
  probe,
  cursor,
  maxChars
}: {
  readonly probe: WorkbenchBrowserFrameDomProbeResult;
  readonly cursor: number;
  readonly maxChars: number;
}): DocumentFallbackResult | null => {
  const source = probe.containerText ?? probe.bodyText ?? probe.selectionText;
  if (typeof source !== "string" || source.trim().length === 0) {
    return null;
  }
  return {
    text: source.slice(cursor, cursor + maxChars),
    extractionMethod:
      probe.containerText !== undefined ? "viewer:container-dom" : "viewer:visible-dom",
    fallbackReason: "generic-viewer-dom"
  };
};
