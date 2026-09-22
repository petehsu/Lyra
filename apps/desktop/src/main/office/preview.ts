import { readFile } from "node:fs/promises";

import { officeFormatFromPath, officeTitleFromPath, type OfficeDocumentFormat } from "./paths";

export class OfficePreviewError extends Error {
  readonly code: "unsupported";

  constructor(code: OfficePreviewError["code"], message: string) {
    super(message);
    this.name = "OfficePreviewError";
    this.code = code;
  }
}

export type OfficePreview = {
  readonly format: OfficeDocumentFormat;
  readonly title: string;
  readonly bytes: Uint8Array;
};

export const previewOfficeFile = async (
  filePath: string,
  deps: {
    readonly readFile?: (path: string) => Promise<Uint8Array>;
  } = {}
): Promise<OfficePreview> => {
  const format = officeFormatFromPath(filePath);
  if (format === null) {
    throw new OfficePreviewError("unsupported", "This file is not a pdf, docx, xlsx, or pptx.");
  }
  const read = deps.readFile ?? (async (path) => new Uint8Array(await readFile(path)));
  return {
    format,
    title: officeTitleFromPath(filePath),
    bytes: await read(filePath)
  };
};
