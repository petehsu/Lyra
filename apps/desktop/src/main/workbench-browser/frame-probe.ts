import type {
  WorkbenchBrowserFrameDomProbeCandidate,
  WorkbenchBrowserFrameDomProbeResult
} from "./types";

const coerceString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const coerceNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const coerceNumberList = (value: unknown): readonly number[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const numbers = value
    .filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
    .map((entry) => Math.max(1, Math.round(entry)));
  return numbers.length > 0 ? numbers : undefined;
};

const isDocumentFormat = (value: unknown): value is WorkbenchBrowserFrameDomProbeCandidate["formatHint"] =>
  value === "pdf" ||
  value === "docx" ||
  value === "xlsx" ||
  value === "pptx" ||
  value === "image" ||
  value === "unknown";

const coerceCandidate = (value: unknown): WorkbenchBrowserFrameDomProbeCandidate | null => {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const sourceKind = record.sourceKind;
  if (sourceKind !== "iframe" && sourceKind !== "embed" && sourceKind !== "object") {
    return null;
  }
  const documentUrl = coerceString(record.documentUrl);
  const mimeHint = coerceString(record.mimeHint);
  const titleHint = coerceString(record.titleHint);
  return {
    sourceKind,
    ...(documentUrl === undefined ? {} : { documentUrl }),
    ...(mimeHint === undefined ? {} : { mimeHint }),
    formatHint: isDocumentFormat(record.formatHint) ? record.formatHint : "unknown",
    visibleRatio: Math.max(0, Math.min(1, coerceNumber(record.visibleRatio) ?? 0)),
    ...(titleHint === undefined ? {} : { titleHint })
  };
};

export const buildFrameDomProbeScript = ({
  maxChars
}: {
  readonly maxChars: number;
}): string => `
  (() => {
    const maxChars = ${Math.max(512, Math.round(maxChars))};
    const normalizeText = (value) => {
      if (typeof value !== "string") {
        return "";
      }
      return value
        .replace(/\u00a0/g, " ")
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n[ \t]+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    };
    const readText = (node) => normalizeText(node?.innerText ?? node?.textContent ?? "");
    const visibleRatioFor = (element) => {
      if (!element || typeof element.getBoundingClientRect !== "function") {
        return 0;
      }
      const rect = element.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
      const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
      if (rect.width <= 0 || rect.height <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
        return 0;
      }
      const overlapX = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
      const overlapY = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
      const visibleArea = overlapX * overlapY;
      const totalArea = rect.width * rect.height;
      if (!Number.isFinite(visibleArea) || !Number.isFinite(totalArea) || totalArea <= 0) {
        return 0;
      }
      return Math.max(0, Math.min(1, visibleArea / totalArea));
    };
    const inferFormat = (url, mimeHint) => {
      const lowerUrl = typeof url === "string" ? url.toLowerCase() : "";
      const lowerMime = typeof mimeHint === "string" ? mimeHint.toLowerCase() : "";
      if (lowerMime.includes("application/pdf") || lowerUrl.endsWith(".pdf") || lowerUrl.includes(".pdf?")) {
        return "pdf";
      }
      if (
        lowerMime.includes("wordprocessingml.document") ||
        lowerMime.includes("application/msword") ||
        lowerUrl.endsWith(".docx") ||
        lowerUrl.includes(".docx?")
      ) {
        return "docx";
      }
      if (
        lowerMime.includes("spreadsheetml.sheet") ||
        lowerMime.includes("application/vnd.ms-excel") ||
        lowerUrl.endsWith(".xlsx") ||
        lowerUrl.includes(".xlsx?")
      ) {
        return "xlsx";
      }
      if (
        lowerMime.includes("presentationml.presentation") ||
        lowerMime.includes("application/vnd.ms-powerpoint") ||
        lowerUrl.endsWith(".pptx") ||
        lowerUrl.includes(".pptx?")
      ) {
        return "pptx";
      }
      if (
        lowerMime.startsWith("image/") ||
        /\\.(png|jpe?g|webp|gif|bmp|tiff?|svg)(\\?|#|$)/.test(lowerUrl)
      ) {
        return "image";
      }
      return "unknown";
    };
    const embeddedDocuments = [];
    for (const node of Array.from(document.querySelectorAll("iframe[src], embed[src], object[data]"))) {
      const sourceKind = node.tagName === "IFRAME" ? "iframe" : node.tagName === "EMBED" ? "embed" : "object";
      const documentUrl =
        sourceKind === "iframe"
          ? node.getAttribute("src")
          : sourceKind === "embed"
            ? node.getAttribute("src")
            : node.getAttribute("data");
      const mimeHint = node.getAttribute("type") ?? undefined;
      embeddedDocuments.push({
        sourceKind,
        documentUrl: typeof documentUrl === "string" && documentUrl.length > 0 ? documentUrl : undefined,
        mimeHint,
        formatHint: inferFormat(documentUrl, mimeHint),
        visibleRatio: visibleRatioFor(node),
        titleHint: normalizeText(node.getAttribute("title") ?? "") || undefined
      });
    }

    const pageNodes = Array.from(document.querySelectorAll(".page[data-page-number]"));
    const visiblePageIndices = pageNodes
      .map((node) => ({
        visibleRatio: visibleRatioFor(node),
        pageNumber: Number(node.getAttribute("data-page-number") ?? NaN)
      }))
      .filter((entry) => Number.isFinite(entry.pageNumber) && entry.visibleRatio > 0.05)
      .sort((left, right) => right.visibleRatio - left.visibleRatio)
      .map((entry) => Math.max(1, Math.round(entry.pageNumber)));

    const pageNumberInput = document.querySelector("#pageNumber");
    const currentPageFromInput = pageNumberInput instanceof HTMLInputElement ? Number(pageNumberInput.value) : NaN;
    const currentPageIndex = Number.isFinite(currentPageFromInput) && currentPageFromInput > 0
      ? Math.round(currentPageFromInput)
      : (visiblePageIndices[0] ?? undefined);

    const numPagesNode = document.querySelector("#numPages");
    const pageCountText = normalizeText(numPagesNode?.textContent ?? "").replace(/^of\s+/i, "");
    const currentPageCount = Number(pageCountText);
    const pageCount = Number.isFinite(currentPageCount) && currentPageCount > 0
      ? Math.round(currentPageCount)
      : (pageNodes.length > 0 ? pageNodes.length : undefined);

    const visibleLayerText = normalizeText(
      Array.from(document.querySelectorAll(".page[data-page-number] .textLayer, .textLayer"))
        .map((node) => {
          const parentPage = node.closest(".page[data-page-number]");
          if (parentPage && visibleRatioFor(parentPage) <= 0.05) {
            return "";
          }
          return readText(node);
        })
        .join("\n\n")
    );

    const viewerDocumentUrl = (() => {
      const hiddenInput = document.querySelector("#pdf-file-uri");
      if (hiddenInput instanceof HTMLInputElement) {
        const value = normalizeText(hiddenInput.value ?? "");
        if (value.length > 0) {
          return value;
        }
      }
      const openParams = document.querySelector("#pdf-document-init-params");
      if (openParams instanceof HTMLInputElement) {
        const datasetUrl = normalizeText(openParams.getAttribute("data-url") ?? "");
        if (datasetUrl.length > 0) {
          return datasetUrl;
        }
      }
      return undefined;
    })();

    const containerText = normalizeText(
      readText(document.querySelector("#viewerContainer"))
      || readText(document.querySelector("#viewer"))
      || readText(document.body)
    );
    const viewerKind = document.querySelector("#viewerContainer, #viewer, .textLayer, .pdfViewer")
      ? "pdfjs"
      : undefined;

    return {
      title: normalizeText(document.title ?? "") || undefined,
      bodyText: readText(document.body).slice(0, maxChars),
      selectionText: normalizeText(String(window.getSelection?.() ?? "")) || undefined,
      viewerKind,
      viewerDocumentUrl,
      viewerText: visibleLayerText.slice(0, maxChars) || undefined,
      containerText: containerText.slice(0, maxChars) || undefined,
      currentPageIndex,
      pageCount,
      visiblePageIndices,
      embeddedDocuments
    };
  })()
`;

export const normalizeFrameDomProbeResult = (value: unknown): WorkbenchBrowserFrameDomProbeResult => {
  const record = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const embeddedDocuments = Array.isArray(record.embeddedDocuments)
    ? record.embeddedDocuments
        .map((entry) => coerceCandidate(entry))
        .filter((entry): entry is WorkbenchBrowserFrameDomProbeCandidate => entry !== null)
    : [];

  const title = coerceString(record.title);
  const bodyText = coerceString(record.bodyText);
  const selectionText = coerceString(record.selectionText);
  const viewerDocumentUrl = coerceString(record.viewerDocumentUrl);
  const viewerText = coerceString(record.viewerText);
  const containerText = coerceString(record.containerText);
  const currentPageIndex = coerceNumber(record.currentPageIndex);
  const pageCount = coerceNumber(record.pageCount);
  const visiblePageIndices = coerceNumberList(record.visiblePageIndices);

  return {
    ...(title === undefined ? {} : { title }),
    ...(bodyText === undefined ? {} : { bodyText }),
    ...(selectionText === undefined ? {} : { selectionText }),
    ...(record.viewerKind === "pdfjs" || record.viewerKind === "generic"
      ? { viewerKind: record.viewerKind }
      : {}),
    ...(viewerDocumentUrl === undefined ? {} : { viewerDocumentUrl }),
    ...(viewerText === undefined ? {} : { viewerText }),
    ...(containerText === undefined ? {} : { containerText }),
    ...(currentPageIndex === undefined ? {} : { currentPageIndex: Math.max(1, Math.round(currentPageIndex)) }),
    ...(pageCount === undefined ? {} : { pageCount: Math.max(1, Math.round(pageCount)) }),
    ...(visiblePageIndices === undefined ? {} : { visiblePageIndices }),
    embeddedDocuments
  };
};
