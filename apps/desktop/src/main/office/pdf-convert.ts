import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

import {
  convertPdfToDocx,
  convertPdfToPptx,
  convertPdfToXlsx,
  type PdfiumModule
} from "@genoffice/pdf2docx";

const require = createRequire(import.meta.url);

export type PdfOfficeTarget = "docx" | "pptx" | "xlsx";

let pdfiumPromise: Promise<PdfiumModule> | null = null;

const wasmPath = (): string => {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resources) {
    const packaged = join(resources, "pdfium.wasm");
    if (existsSync(packaged)) return packaged;
  }
  return require.resolve("@embedpdf/pdfium/pdfium.wasm");
};

const loadPdfium = (): Promise<PdfiumModule> => {
  pdfiumPromise ??= (async () => {
    const { init } = await import("@embedpdf/pdfium") as {
      init: (overrides: object) => Promise<object>;
    };
    const raw = await readFile(wasmPath());
    const wasmBinary = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    const wrapped = await init({ wasmBinary, thisProgram: "lyra" }) as { pdfium?: PdfiumModule };
    const module = (wrapped.pdfium ?? wrapped) as PdfiumModule & { _PDFiumExt_Init: () => void };
    module._PDFiumExt_Init();
    return module;
  })();
  return pdfiumPromise;
};

export const pdfConversionSource = (ops: readonly unknown[]): string | undefined => {
  const first = ops[0];
  if (typeof first !== "object" || first === null || Array.isArray(first)) {
    return undefined;
  }
  const record = first as Record<string, unknown>;
  if (record.op !== "convert_pdf") {
    return undefined;
  }
  if (typeof record.source !== "string" || !record.source.toLowerCase().endsWith(".pdf")) {
    throw new Error("op 0 (convert_pdf) rejected: source must be a pdf path");
  }
  return record.source;
};

export const convertPdfBytes = async (
  source: Uint8Array,
  target: PdfOfficeTarget
): Promise<Uint8Array> => {
  const pdfium = await loadPdfium();
  if (target === "docx") {
    return (await convertPdfToDocx(source, { pdfium })).docx;
  }
  if (target === "pptx") {
    return (await convertPdfToPptx(source, { pdfium })).pptx;
  }
  return (await convertPdfToXlsx(source, { pdfium, cellData: true })).xlsx;
};
