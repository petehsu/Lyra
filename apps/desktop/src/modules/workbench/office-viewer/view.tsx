import { useEffect, useRef, useState } from "react";

import type { LyraDesktopApi, OfficePreviewResult } from "../../../shared/desktop-bridge";

type OfficeViewerStatus = "loading" | "ready" | "error";
type OfficeHandle = { readonly destroy: () => void };

const decodeBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const bytesToArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const countLabel = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

const renderPdf = async (
  host: HTMLElement,
  bytes: Uint8Array,
  isCancelled: () => boolean
): Promise<{ readonly handle: OfficeHandle; readonly detail: string } | null> => {
  const pdfjs = await import("pdfjs-dist");
  if (typeof pdfjs.GlobalWorkerOptions.workerSrc !== "string" || pdfjs.GlobalWorkerOptions.workerSrc.length === 0) {
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  const pdfDocument = await pdfjs.getDocument({ data: bytes }).promise;
  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      if (isCancelled()) {
        await pdfDocument.destroy();
        return null;
      }
      const page = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.25 });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.display = "block";
      canvas.style.margin = "0 auto var(--lyra-space-16)";
      canvas.style.background = "canvas";
      const context = canvas.getContext("2d");
      if (context === null) {
        continue;
      }
      await page.render({ canvasContext: context, viewport }).promise;
      if (isCancelled()) {
        await pdfDocument.destroy();
        return null;
      }
      host.append(canvas);
    }
  } catch (error) {
    await pdfDocument.destroy();
    throw error;
  }
  return {
    handle: { destroy: () => { void pdfDocument.destroy(); } },
    detail: countLabel(pdfDocument.numPages, "page", "pages")
  };
};

const finishViewer = <T extends OfficeHandle>(
  viewer: T,
  isCancelled: () => boolean,
  detail: (viewer: T) => void
): OfficeHandle | null => {
  if (isCancelled()) {
    viewer.destroy();
    return null;
  }
  detail(viewer);
  return viewer;
};

const renderOfficeFile = async (
  host: HTMLElement,
  preview: OfficePreviewResult,
  isCancelled: () => boolean,
  onDetail: (detail: string) => void
): Promise<OfficeHandle | null> => {
  const bytes = decodeBase64(preview.fileBase64);
  if (preview.format === "pdf") {
    host.style.overflow = "auto";
    host.style.padding = "var(--lyra-space-16)";
    const rendered = await renderPdf(host, bytes, isCancelled);
    if (rendered === null) return null;
    onDetail(rendered.detail);
    return rendered.handle;
  }
  host.style.overflow = "hidden";
  host.style.padding = "0";
  const data = bytesToArrayBuffer(bytes);
  if (preview.format === "docx") {
    const { DocxScrollViewer } = await import("@silurus/ooxml/docx");
    const viewer = new DocxScrollViewer(host, {
      useGoogleFonts: false,
      enableTextSelection: true,
      refitOnResize: false,
      onVisiblePageChange: (_index, total) => {
        if (!isCancelled() && total > 0) onDetail(countLabel(total, "page", "pages"));
      }
    });
    try {
      await viewer.load(data);
    } catch (error) {
      viewer.destroy();
      throw error;
    }
    return finishViewer(viewer, isCancelled, (loaded) => {
      if (loaded.pageCount > 0) onDetail(countLabel(loaded.pageCount, "page", "pages"));
    });
  }
  if (preview.format === "xlsx") {
    const { XlsxViewer } = await import("@silurus/ooxml/xlsx");
    const viewer = new XlsxViewer(host, { useGoogleFonts: false });
    try {
      await viewer.load(data);
    } catch (error) {
      viewer.destroy();
      throw error;
    }
    return finishViewer(viewer, isCancelled, (loaded) => {
      onDetail(countLabel(loaded.sheetCount, "sheet", "sheets"));
    });
  }
  const { PptxScrollViewer } = await import("@silurus/ooxml/pptx");
  const viewer = new PptxScrollViewer(host, {
    useGoogleFonts: false,
    enableTextSelection: true,
    refitOnResize: false,
    onVisibleSlideChange: (_index, total) => {
      if (!isCancelled() && total > 0) onDetail(countLabel(total, "slide", "slides"));
    }
  });
  try {
    await viewer.load(data);
  } catch (error) {
    viewer.destroy();
    throw error;
  }
  return finishViewer(viewer, isCancelled, (loaded) => {
    if (loaded.slideCount > 0) onDetail(countLabel(loaded.slideCount, "slide", "slides"));
  });
};

export const OfficeViewerSurface = ({
  desktopApi,
  filePath,
  title
}: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly filePath: string;
  readonly title: string;
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<OfficeViewerStatus>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const office = desktopApi?.office;
    if (host === null || office === undefined) {
      setStatus("error");
      setMessage(office === undefined ? "Office preview is unavailable." : null);
      return undefined;
    }
    let cancelled = false;
    let teardown: (() => void) | undefined;
    setStatus("loading");
    setMessage(null);
    setDetail(null);
    host.replaceChildren();
    host.style.overflow = "hidden";
    host.style.padding = "0";
    void (async () => {
      let handle: OfficeHandle | undefined;
      try {
        const preview = await office.preview({ path: filePath });
        if (cancelled) return;
        handle = await renderOfficeFile(host, preview, () => cancelled, (next) => {
          if (!cancelled) setDetail(next);
        }) ?? undefined;
        if (handle === undefined || cancelled) {
          handle?.destroy();
          return;
        }
        teardown = () => handle?.destroy();
        setStatus("ready");
      } catch (error) {
        handle?.destroy();
        if (!cancelled) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      cancelled = true;
      teardown?.();
      host.replaceChildren();
    };
  }, [desktopApi, filePath]);

  return (
    <section
      className="lyra-app-module"
      data-lyra-component="lyra.office"
      aria-label="office-viewer-surface"
      style={{
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr) auto",
        minHeight: "0",
        height: "100%",
        background: "var(--lyra-app-panel-bg)",
        color: "var(--lyra-text-primary)"
      }}
    >
      <header className="lyra-app-module-toolbar">
        <strong>{title}</strong>
      </header>
      <div
        ref={hostRef}
        style={{ minHeight: "0", height: "100%", overflow: "hidden", padding: "0" }}
      />
      <footer className="lyra-app-module-footer">
        <span>
          {status === "error"
            ? message
            : status === "loading"
              ? "Opening…"
              : detail}
        </span>
      </footer>
    </section>
  );
};
