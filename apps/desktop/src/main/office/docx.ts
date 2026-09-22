import { readFile, writeFile } from "node:fs/promises";

import { parseDocx, saveDocx, type Block, type SaveBlock } from "@genoffice/docx-engine";
import { patchParagraphTexts } from "@genoffice/docx-engine/text-patch";

const PREVIEW_CHARS = 200;

export type OfficeDocxBlock = {
  readonly index: number;
  readonly type: string;
  readonly preview: string;
};

export type OfficeDocxRead = {
  readonly format: "docx";
  readonly blocks: readonly OfficeDocxBlock[];
};

export class OfficeDocxError extends Error {
  readonly index: number;

  constructor(index: number, message: string) {
    super(message);
    this.name = "OfficeDocxError";
    this.index = index;
  }
}

type SetTextOp = {
  readonly index: number;
  readonly block: number;
  readonly text: string;
};

const clip = (value: string): string =>
  value.length <= PREVIEW_CHARS ? value : `${value.slice(0, PREVIEW_CHARS)}…`;

const blockText = (block: Block): string => {
  if (block.runs !== undefined && block.runs.length > 0) {
    return block.runs.map((run) => run.text).join("");
  }
  return block.previewText ?? block.label ?? "";
};

const parseSetTextOp = (value: unknown, index: number): SetTextOp => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OfficeDocxError(index, `op ${index} rejected: expected an object`);
  }
  const record = value as Record<string, unknown>;
  if (record.op !== "set_text") {
    throw new OfficeDocxError(
      index,
      `op ${index} (${typeof record.op === "string" ? record.op : "?"}) rejected: only set_text is available`
    );
  }
  if (typeof record.block !== "number" || !Number.isInteger(record.block) || record.block < 0) {
    throw new OfficeDocxError(index, `op ${index} (set_text) rejected: block must be a non-negative integer`);
  }
  if (typeof record.text !== "string") {
    throw new OfficeDocxError(index, `op ${index} (set_text) rejected: text must be a string`);
  }
  return { index, block: record.block, text: record.text };
};

export const readDocxBytes = async (bytes: Uint8Array): Promise<OfficeDocxRead> => {
  const parsed = await parseDocx(bytes);
  const blocks = parsed.blocks.flatMap((block) => {
    if (block.hidden === true || block.docxIndex === null) {
      return [];
    }
    return [{
      index: block.docxIndex,
      type: block.type,
      preview: clip(blockText(block))
    }];
  });
  return { format: "docx", blocks };
};

export const applyDocxBytes = async (
  bytes: Uint8Array,
  ops: readonly unknown[]
): Promise<{ readonly bytes: Uint8Array; readonly applied: number }> => {
  const parsedOps = ops.map((op, index) => parseSetTextOp(op, index));
  const seen = new Set<number>();
  for (const op of parsedOps) {
    if (seen.has(op.block)) {
      throw new OfficeDocxError(op.index, `op ${op.index} (set_text) rejected: block ${op.block} is targeted twice`);
    }
    seen.add(op.block);
  }
  if (parsedOps.length === 0) {
    return { bytes, applied: 0 };
  }
  const parsed = await parseDocx(bytes);
  const visible = parsed.blocks.filter((block) => block.hidden !== true);
  const byIndex = new Map(
    visible.flatMap((block) => block.docxIndex === null ? [] : [[block.docxIndex, block] as const])
  );
  const replacements = new Map<number, string>();
  for (const op of parsedOps) {
    const block = byIndex.get(op.block);
    if (block === undefined || block.originalXml === null) {
      throw new OfficeDocxError(
        op.index,
        `op ${op.index} (set_text) rejected: block ${op.block} is not an editable paragraph`
      );
    }
    const patched = patchParagraphTexts(block.originalXml, op.text);
    if (patched === null) {
      throw new OfficeDocxError(
        op.index,
        `op ${op.index} (set_text) rejected: block ${op.block} text cannot be patched in place`
      );
    }
    replacements.set(op.block, patched);
  }
  const finalBlocks: SaveBlock[] = [];
  for (const block of visible) {
    if (block.docxIndex === null) {
      continue;
    }
    const xml = replacements.get(block.docxIndex);
    if (xml === undefined) {
      finalBlocks.push({ kind: "original", docxIndex: block.docxIndex });
    } else {
      finalBlocks.push({ kind: "xml", xml, docxIndex: block.docxIndex });
    }
  }
  const next = await saveDocx(parsed, finalBlocks);
  return { bytes: next, applied: parsedOps.length };
};

export const readDocxFile = async (filePath: string): Promise<OfficeDocxRead> =>
  readDocxBytes(new Uint8Array(await readFile(filePath)));

export const applyDocxFile = async (
  filePath: string,
  ops: readonly unknown[]
): Promise<{ readonly applied: number; readonly written: boolean }> => {
  const original = new Uint8Array(await readFile(filePath));
  const result = await applyDocxBytes(original, ops);
  const written = result.bytes.byteLength !== original.byteLength
    || result.bytes.some((byte, index) => byte !== original[index]);
  if (written) {
    await writeFile(filePath, result.bytes);
  }
  return { applied: result.applied, written };
};
