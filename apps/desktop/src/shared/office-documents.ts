const OFFICE_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "pptx"]);

export type OfficeDocumentFormat = "pdf" | "docx" | "xlsx" | "pptx";

export const officeExtension = (filePath: string): string => {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const name = slash >= 0 ? filePath.slice(slash + 1) : filePath;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
};

export const officeFormatFromPath = (filePath: string): OfficeDocumentFormat | null => {
  const extension = officeExtension(filePath);
  return OFFICE_EXTENSIONS.has(extension) ? extension as OfficeDocumentFormat : null;
};

export const isOfficeDocumentPath = (filePath: string): boolean =>
  officeFormatFromPath(filePath) !== null;

export const officeTitleFromPath = (filePath: string): string => {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const name = slash >= 0 ? filePath.slice(slash + 1) : filePath;
  return name.length > 0 ? name : filePath;
};

export const assertOfficeEditPath = (
  filePath: string,
  action: "read" | "apply"
): Exclude<OfficeDocumentFormat, "pdf"> => {
  const format = officeFormatFromPath(filePath);
  if (format === "docx" || format === "xlsx" || format === "pptx") {
    return format;
  }
  if (format === "pdf") {
    throw new Error(`office ${action} is available for docx, xlsx, and pptx. pdf can be previewed.`);
  }
  throw new Error(`office ${action} is available for docx, xlsx, and pptx.`);
};
