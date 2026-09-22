import { readFile, writeFile } from "node:fs/promises";

import { applyWorkbookOps } from "@genoffice/xlsx-dsl";
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

export type OfficeXlsxRead = {
  readonly format: "xlsx";
  readonly truncated: boolean;
  readonly sheets: readonly OfficeXlsxSheet[];
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
  return { format: "xlsx", truncated, sheets };
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
  try {
    const result = await applyWorkbookOps(Buffer.from(bytes), ops.map(toDslOp));
    return { bytes: result.buffer, applied: result.applied };
  } catch (error) {
    if (error instanceof OfficeXlsxError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const index = /ops\[(\d+)\]/.exec(message);
    throw new OfficeXlsxError(index === null ? 0 : Number(index[1]), message);
  }
};

const bytesDiffer = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength !== right.byteLength || left.some((byte, index) => byte !== right[index]);

export const readXlsxFile = async (filePath: string): Promise<OfficeXlsxRead> =>
  readXlsxBytes(new Uint8Array(await readFile(filePath)));

export const applyXlsxFile = async (
  filePath: string,
  ops: readonly unknown[]
): Promise<{ readonly applied: number; readonly written: boolean }> => {
  const original = new Uint8Array(await readFile(filePath));
  const result = await applyXlsxBytes(original, ops);
  const written = bytesDiffer(original, result.bytes);
  if (written) {
    await writeFile(filePath, result.bytes);
  }
  return { applied: result.applied, written };
};
