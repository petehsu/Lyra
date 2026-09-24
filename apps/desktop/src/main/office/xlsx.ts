import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

import { applyWorkbookOps } from "@genoffice/xlsx-dsl";
import { blankXlsxBuffer } from "@genoffice/xlsx-gateway/gateway/csv-import";
import { convertPdfBytes, pdfConversionSource } from "./pdf-convert";
import { readBasicWorkbook, type CellState } from "@genoffice/xlsx-gateway/gateway/xlsx-gateway";

const PREVIEW_CHARS = 200;
const CELL_CAP = 500;

export type OfficeXlsxCell = {
  readonly address: string;
  readonly value: string | number | boolean | null;
  readonly formula?: string;
};

export type OfficeXlsxSheet = {
  readonly name: string;
  readonly cells: readonly OfficeXlsxCell[];
};

export type OfficeXlsxChart = {
  readonly path: string;
  readonly sheet: string | null;
};

export type OfficeXlsxName = {
  readonly name: string;
  readonly ref: string;
};

export type OfficeXlsxCheck = {
  readonly code: "formula_error";
  readonly sheet: string;
  readonly address: string;
  readonly message: string;
};

export type OfficeXlsxRead = {
  readonly format: "xlsx";
  readonly truncated: boolean;
  readonly sheets: readonly OfficeXlsxSheet[];
  readonly charts: readonly OfficeXlsxChart[];
  readonly names: readonly OfficeXlsxName[];
  readonly checks?: readonly OfficeXlsxCheck[];
};

export class OfficeXlsxError extends Error {
  readonly index: number;

  constructor(index: number, message: string) {
    super(message);
    this.name = "OfficeXlsxError";
    this.index = index;
  }
}

const clip = (value: string): string =>
  value.length <= PREVIEW_CHARS ? value : `${value.slice(0, PREVIEW_CHARS)}…`;

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
};

const cellKey = (value: unknown): string | undefined => {
  const record = asRecord(value);
  if (record === undefined || (record.op !== "set_cell" && record.op !== "set_formula")) {
    return undefined;
  }
  const address = typeof record.address === "string"
    ? record.address
    : typeof record.cell === "string" ? record.cell : undefined;
  if (address === undefined) {
    return undefined;
  }
  return typeof record.sheet === "string" && record.sheet.length > 0 ? `${record.sheet}!${address}` : address;
};

const toDslOp = (value: unknown): unknown => {
  const record = asRecord(value);
  if (record === undefined) {
    return value;
  }
  const op = { ...record };
  if ((op.op === "set_cell" || op.op === "set_formula") && typeof op.cell === "string" && op.address === undefined) {
    op.address = op.cell;
    delete op.cell;
  }
  if (op.op === "set_formula" && typeof op.formula === "string" && !op.formula.startsWith("=")) {
    op.formula = `=${op.formula}`;
  }
  return op;
};

const populated = (cell: CellState): boolean => cell.formula !== undefined || cell.value !== null;

export const readXlsxBytes = async (bytes: Uint8Array): Promise<OfficeXlsxRead> => {
  const imported = await readBasicWorkbook(Buffer.from(bytes));
  const sheets: OfficeXlsxSheet[] = [];
  let count = 0;
  let truncated = false;
  for (const sheet of imported.snapshot.sheets) {
    const cells: OfficeXlsxCell[] = [];
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (!populated(cell)) {
        continue;
      }
      if (count >= CELL_CAP) {
        truncated = true;
        break;
      }
      const value = typeof cell.value === "string" ? clip(cell.value) : cell.value;
      cells.push({
        address,
        value,
        ...(cell.formula === undefined ? {} : { formula: clip(cell.formula) })
      });
      count += 1;
    }
    sheets.push({ name: sheet.name, cells });
    if (truncated) {
      break;
    }
  }
  return { format: "xlsx", truncated, sheets, ...packageFacts(bytes) };
};

export const applyXlsxBytes = async (
  bytes: Uint8Array,
  ops: readonly unknown[]
): Promise<{ readonly bytes: Uint8Array; readonly applied: number }> => {
  if (ops.length === 0) {
    return { bytes, applied: 0 };
  }
  const seen = new Set<string>();
  for (const [index, op] of ops.entries()) {
    const key = cellKey(op);
    if (key === undefined) {
      continue;
    }
    if (seen.has(key)) {
      throw new OfficeXlsxError(index, `op ${index} rejected: ${key} is targeted twice`);
    }
    seen.add(key);
  }
  const dir = await mkdtemp(join(tmpdir(), "lyra-xlsx-"));
  try {
    const sourcePath = join(dir, "book.xlsx");
    await writeFile(sourcePath, bytes);
    const result = await applyWorkbookOps(Buffer.from(bytes), ops.map(toDslOp), { sourcePath });
    return { bytes: result.buffer, applied: result.applied };
  } catch (error) {
    if (error instanceof OfficeXlsxError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const index = /ops\[(\d+)\]/.exec(message);
    throw new OfficeXlsxError(index === null ? 0 : Number(index[1]), message);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const bytesDiffer = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength !== right.byteLength || left.some((byte, index) => byte !== right[index]);

const zipXml = (archive: Uint8Array): Map<string, string> => {
  const buf = Buffer.from(archive);
  const out = new Map<string, string>();
  let offset = 0;
  while (offset + 30 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const method = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const nameLength = buf.readUInt16LE(offset + 26);
    const extraLength = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLength).toString();
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = buf.subarray(dataStart, dataStart + compressedSize);
    if (name.endsWith(".xml") || name.endsWith(".rels")) {
      out.set(name, (method === 0 ? data : inflateRawSync(data)).toString("utf8"));
    }
    offset = dataStart + compressedSize;
  }
  return out;
};

const sheetOfFormula = (formula: string): string | null => {
  const quoted = /^'((?:[^']|'')*)'!/.exec(formula.trim());
  if (quoted?.[1]) {
    return quoted[1].replace(/''/g, "'");
  }
  const plain = /^([^!]+)!/.exec(formula.trim());
  return plain?.[1] ?? null;
};

const packageFacts = (bytes: Uint8Array): Pick<OfficeXlsxRead, "charts" | "names" | "checks"> => {
  const parts = zipXml(bytes);
  const workbook = parts.get("xl/workbook.xml") ?? "";
  const names: OfficeXlsxName[] = [];
  for (const match of workbook.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) {
    const name = /name="([^"]+)"/.exec(match[1] ?? "")?.[1];
    if (!name || name.startsWith("_xlnm")) {
      continue;
    }
    names.push({ name, ref: (match[2] ?? "").trim() });
  }
  const sheetByRid = new Map<string, string>();
  for (const match of workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"|<sheet\b[^>]*r:id="([^"]+)"[^>]*name="([^"]+)"/g)) {
    const name = match[1] ?? match[4];
    const rid = match[2] ?? match[3];
    if (name && rid) {
      sheetByRid.set(rid, name);
    }
  }
  const workbookRels = parts.get("xl/_rels/workbook.xml.rels") ?? "";
  const sheetPathByName = new Map<string, string>();
  for (const match of workbookRels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="([^"]+)"/g)) {
    const id = match[1] ?? match[4];
    const target = match[2] ?? match[3];
    const sheet = id ? sheetByRid.get(id) : undefined;
    if (sheet && target?.includes("worksheet")) {
      const path = target.replace(/^\//, "").replace(/^\.\.\//, "");
      sheetPathByName.set(sheet, path.startsWith("xl/") ? path : `xl/${path.replace(/^\.\//, "")}`);
    }
  }
  const chartSheet = new Map<string, string>();
  for (const [path, xml] of parts) {
    if (!path.includes("drawings/_rels/")) {
      continue;
    }
    for (const match of xml.matchAll(/Target="([^"]*charts\/[^"]+)"/g)) {
      const target = match[1] ?? "";
      const chart = target.split("/").pop();
      if (!chart) {
        continue;
      }
      const drawing = path.slice(0, path.lastIndexOf("/_rels/")).split("/").pop();
      for (const [sheet, sheetPath] of sheetPathByName) {
        const rels = parts.get(sheetPath.replace(/([^/]+)$/, `_rels/$1.rels`));
        if (drawing && rels?.includes(drawing)) {
          chartSheet.set(chart, sheet);
        }
      }
    }
  }
  const charts: OfficeXlsxChart[] = [];
  for (const [path, xml] of parts) {
    if (!/^xl\/charts\/[^/]+\.xml$/.test(path)) {
      continue;
    }
    const formula = /<c:f>([\s\S]*?)<\/c:f>/.exec(xml)?.[1];
    const fromFormula = formula ? sheetOfFormula(formula) : null;
    charts.push({
      path,
      sheet: fromFormula ?? chartSheet.get(path.split("/").pop() ?? "") ?? null
    });
  }
  const checks: OfficeXlsxCheck[] = [];
  for (const [sheet, path] of sheetPathByName) {
    const xml = parts.get(path);
    if (!xml) {
      continue;
    }
    for (const match of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      if (!/\bt="e"/.test(match[1] ?? "")) {
        continue;
      }
      const address = /\br="([^"]+)"/.exec(match[1] ?? "")?.[1];
      const message = /<v>([\s\S]*?)<\/v>/.exec(match[2] ?? "")?.[1];
      if (!address || !message) {
        continue;
      }
      checks.push({ code: "formula_error", sheet, address, message });
    }
  }
  return { charts, names, ...(checks.length > 0 ? { checks } : {}) };
};

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

export const readXlsxFile = async (filePath: string): Promise<OfficeXlsxRead> =>
  readXlsxBytes(new Uint8Array(await readFile(filePath)));

export const applyXlsxFile = async (
  filePath: string,
  ops: readonly unknown[]
): Promise<{ readonly applied: number; readonly written: boolean }> => {
  const pdfSource = pdfConversionSource(ops);
  if (pdfSource !== undefined) {
    if (!await absent(filePath)) {
      throw new OfficeXlsxError(0, "op 0 (convert_pdf) rejected: the file already exists");
    }
    const converted = await convertPdfBytes(new Uint8Array(await readFile(pdfSource)), "xlsx");
    const rest = ops.slice(1);
    const result = rest.length === 0 ? { bytes: converted, applied: 0 } : await applyXlsxBytes(converted, rest);
    await writeFile(filePath, result.bytes);
    return { applied: result.applied + 1, written: true };
  }
  const first = asRecord(ops[0]);
  if (first?.op === "create_xlsx") {
    if (!await absent(filePath)) {
      throw new OfficeXlsxError(0, "op 0 (create_xlsx) rejected: the file already exists");
    }
    const sheet = typeof first.sheet === "string" && first.sheet.length > 0 ? first.sheet : undefined;
    const blank = new Uint8Array(await blankXlsxBuffer(sheet));
    const rest = ops.slice(1);
    const result = rest.length === 0 ? { bytes: blank, applied: 0 } : await applyXlsxBytes(blank, rest);
    await writeFile(filePath, result.bytes);
    return { applied: result.applied + 1, written: true };
  }
  const original = new Uint8Array(await readFile(filePath));
  const result = await applyXlsxBytes(original, ops);
  const written = bytesDiffer(original, result.bytes);
  if (written) {
    await writeFile(filePath, result.bytes);
  }
  return { applied: result.applied, written };
};
