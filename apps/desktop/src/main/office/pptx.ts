import { readFile, writeFile } from "node:fs/promises";

import { elementDurableId, openPptx, savePptx, type SlideElement } from "@genoffice/pptx-engine";
import { runTxn } from "@genoffice/pptx-ops";

const PREVIEW_CHARS = 200;

export type OfficePptxElement = {
  readonly id: string;
  readonly type: string;
  readonly preview: string;
};

export type OfficePptxSlide = {
  readonly index: number;
  readonly elements: readonly OfficePptxElement[];
};

export type OfficePptxRead = {
  readonly format: "pptx";
  readonly slides: readonly OfficePptxSlide[];
};

export class OfficePptxError extends Error {
  readonly index: number;

  constructor(index: number, message: string) {
    super(message);
    this.name = "OfficePptxError";
    this.index = index;
  }
}

type TextOp = {
  readonly index: number;
  readonly slide: number;
  readonly element: string;
  readonly text: string;
};

const clip = (value: string): string =>
  value.length <= PREVIEW_CHARS ? value : `${value.slice(0, PREVIEW_CHARS)}…`;

const elementText = (element: SlideElement): string => {
  const paragraphs = element.text?.paragraphs ?? [];
  return paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n");
};

const parseTextOp = (value: unknown, index: number): TextOp => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OfficePptxError(index, `op ${index} rejected: expected an object`);
  }
  const record = value as Record<string, unknown>;
  if (record.op !== "set_text") {
    throw new OfficePptxError(
      index,
      `op ${index} (${typeof record.op === "string" ? record.op : "?"}) rejected: only set_text is available`
    );
  }
  if (typeof record.slide !== "number" || !Number.isInteger(record.slide) || record.slide < 0) {
    throw new OfficePptxError(index, `op ${index} (set_text) rejected: slide must be a non-negative integer`);
  }
  if (typeof record.element !== "string" || record.element.length === 0) {
    throw new OfficePptxError(index, `op ${index} (set_text) rejected: element must be a durable id`);
  }
  if (typeof record.text !== "string") {
    throw new OfficePptxError(index, `op ${index} (set_text) rejected: text must be a string`);
  }
  return { index, slide: record.slide, element: record.element, text: record.text };
};

export const readPptxBytes = async (bytes: Uint8Array): Promise<OfficePptxRead> => {
  const opened = await openPptx(bytes);
  return {
    format: "pptx",
    slides: opened.deck.slides.map((slide, index) => ({
      index,
      elements: slide.elements.flatMap((element) => {
        const id = elementDurableId(element) ?? element.id;
        if (id.length === 0) {
          return [];
        }
        return [{
          id,
          type: element.type,
          preview: clip(elementText(element))
        }];
      })
    }))
  };
};

const asOpRecord = (value: unknown, index: number): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OfficePptxError(index, `op ${index} rejected: expected an object`);
  }
  return value as Record<string, unknown>;
};

const toEngineOp = (value: unknown, index: number): Record<string, unknown> => {
  const record = asOpRecord(value, index);
  if (record.op !== "set_text") {
    if (typeof record.op !== "string" || record.op.length === 0) {
      throw new OfficePptxError(index, `op ${index} rejected: expected an op name`);
    }
    return record;
  }
  const parsed = parseTextOp(value, index);
  return {
    op: "setText",
    target: { slide: parsed.slide, el: parsed.element },
    paragraphs: [{ runs: [{ text: parsed.text }] }]
  };
};

export const applyPptxBytes = async (
  bytes: Uint8Array,
  ops: readonly unknown[]
): Promise<{ readonly bytes: Uint8Array; readonly applied: number }> => {
  const engineOps = ops.map((op, index) => toEngineOp(op, index));
  if (engineOps.length === 0) {
    return { bytes, applied: 0 };
  }
  const seen = new Set<string>();
  for (const [index, op] of engineOps.entries()) {
    if (op.op !== "setText") {
      continue;
    }
    const target = op.target;
    if (typeof target !== "object" || target === null) {
      continue;
    }
    const slide = (target as { slide?: unknown }).slide;
    const element = (target as { el?: unknown }).el;
    const key = `${String(slide)}:${String(element)}`;
    if (seen.has(key)) {
      throw new OfficePptxError(index, `op ${index} (set_text) rejected: ${key} is targeted twice`);
    }
    seen.add(key);
  }
  const opened = await openPptx(bytes);
  const result = runTxn(opened, { ops: engineOps });
  if (!result.applied) {
    const failure = result.failures?.[0];
    throw new OfficePptxError(failure?.index ?? 0, failure?.error ?? "slide edit was rejected");
  }
  return { bytes: await savePptx(opened), applied: engineOps.length };
};

const bytesDiffer = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength !== right.byteLength || left.some((byte, index) => byte !== right[index]);

export const readPptxFile = async (filePath: string): Promise<OfficePptxRead> =>
  readPptxBytes(new Uint8Array(await readFile(filePath)));

export const applyPptxFile = async (
  filePath: string,
  ops: readonly unknown[]
): Promise<{ readonly applied: number; readonly written: boolean }> => {
  const original = new Uint8Array(await readFile(filePath));
  const result = await applyPptxBytes(original, ops);
  const written = bytesDiffer(original, result.bytes);
  if (written) {
    await writeFile(filePath, result.bytes);
  }
  return { applied: result.applied, written };
};
