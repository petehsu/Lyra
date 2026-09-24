import { access, readFile, writeFile } from "node:fs/promises";

import { buildBlankDocx } from "@genoffice/docx-engine";
import { convertPdfBytes, pdfConversionSource } from "./pdf-convert";
import {
  DocxHeadlessError,
  apply as applyHeadless,
  close,
  describe,
  open,
  save,
  validateOps,
  type DocxDescription
} from "@genoffice/docx-headless";

export type OfficeDocxRead = {
  readonly format: "docx";
} & DocxDescription;

export class OfficeDocxError extends Error {
  readonly index: number;

  constructor(index: number, message: string) {
    super(message);
    this.name = "OfficeDocxError";
    this.index = index;
  }
}

const officeError = (error: unknown): never => {
  if (error instanceof DocxHeadlessError) {
    throw new OfficeDocxError(error.index, error.message);
  }
  throw error;
};

export const readDocxBytes = async (bytes: Uint8Array): Promise<OfficeDocxRead> => {
  const doc = await open(bytes);
  try {
    return { format: "docx", ...describe(doc) };
  } finally {
    close(doc);
  }
};

export const applyDocxBytes = async (
  bytes: Uint8Array,
  ops: readonly unknown[]
): Promise<{ readonly bytes: Uint8Array; readonly applied: number }> => {
  if (ops.length === 0) {
    return { bytes, applied: 0 };
  }
  try {
    validateOps(ops);
  } catch (error) {
    officeError(error);
  }
  const doc = await open(bytes);
  try {
    await applyHeadless(doc, ops);
    return { bytes: await save(doc), applied: ops.length };
  } catch (error) {
    officeError(error);
  } finally {
    close(doc);
  }
};

export const readDocxFile = async (filePath: string): Promise<OfficeDocxRead> =>
  readDocxBytes(new Uint8Array(await readFile(filePath)));

const absent = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return true;
    }
    throw error;
  }
};

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ponytail: headings and paragraphs only. The reference markdown app is a Tiptap editor
// (images, tables, diagrams); that package is not copied.
const markdownToHtml = (markdown: string): string =>
  markdown.replace(/\r\n/g, "\n").trim().split(/\n{2,}/).filter((block) => block.length > 0).map((block) => {
    const heading = /^(#{1,6})[ \t]+(.+)$/.exec(block);
    if (heading && !block.includes("\n")) {
      const level = heading[1]?.length ?? 1;
      return `<h${level}>${escapeHtml(heading[2] ?? "")}</h${level}>`;
    }
    return `<p>${block.split("\n").map(escapeHtml).join("<br>")}</p>`;
  }).join("");

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
};

export const applyDocxFile = async (
  filePath: string,
  ops: readonly unknown[]
): Promise<{ readonly applied: number; readonly written: boolean }> => {
  const pdfSource = pdfConversionSource(ops);
  if (pdfSource !== undefined) {
    if (!await absent(filePath)) {
      throw new OfficeDocxError(0, "op 0 (convert_pdf) rejected: the file already exists");
    }
    const converted = await convertPdfBytes(new Uint8Array(await readFile(pdfSource)), "docx");
    const rest = ops.slice(1);
    const result = rest.length === 0 ? { bytes: converted, applied: 0 } : await applyDocxBytes(converted, rest);
    await writeFile(filePath, result.bytes);
    return { applied: result.applied + 1, written: true };
  }
  const first = asRecord(ops[0]);
  if (first?.op === "create_docx") {
    if (!await absent(filePath)) {
      throw new OfficeDocxError(0, "op 0 (create_docx) rejected: the file already exists");
    }
    if (typeof first.markdown !== "string") {
      throw new OfficeDocxError(0, "op 0 (create_docx) rejected: markdown must be a string");
    }
    const html = markdownToHtml(first.markdown);
    const blank = new Uint8Array(await buildBlankDocx());
    const seeded = html.length === 0
      ? { bytes: blank, applied: 0 }
      : await applyDocxBytes(blank, [{ op: "insert_content", html }]);
    const rest = ops.slice(1);
    const result = rest.length === 0 ? seeded : await applyDocxBytes(seeded.bytes, rest);
    await writeFile(filePath, result.bytes);
    return { applied: result.applied + 1, written: true };
  }
  const original = new Uint8Array(await readFile(filePath));
  const result = await applyDocxBytes(original, ops);
  const written = result.bytes.byteLength !== original.byteLength
    || result.bytes.some((byte, index) => byte !== original[index]);
  if (written) {
    await writeFile(filePath, result.bytes);
  }
  return { applied: result.applied, written };
};
