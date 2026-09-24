export type PdfiumModule = {
  _PDFiumExt_Init: () => void;
};

export function convertPdfToDocx(
  pdf: Uint8Array,
  opts: { readonly pdfium: PdfiumModule }
): Promise<{ readonly docx: Uint8Array }>;

export function convertPdfToPptx(
  pdf: Uint8Array,
  opts: { readonly pdfium: PdfiumModule }
): Promise<{ readonly pptx: Uint8Array }>;

export function convertPdfToXlsx(
  pdf: Uint8Array,
  opts: { readonly pdfium: PdfiumModule; readonly cellData?: boolean }
): Promise<{ readonly xlsx: Uint8Array }>;
