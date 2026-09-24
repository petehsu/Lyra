import { access, readFile, writeFile } from "node:fs/promises";

import { buildDeckPptx, parsePageSpecObject, type PageSpec } from "@genoffice/pipelines";
import { convertPdfBytes, pdfConversionSource } from "./pdf-convert";
import {
  deleteSlide,
  elementDurableId,
  getSlideNotes,
  mergeSlideFromPptx,
  moveSlide,
  openPptx,
  promoteSlideBackground,
  savePptx,
  slideDurableId,
  type OpenedPptx,
  type SlideElement
} from "@genoffice/pptx-engine";
import { runTxn } from "@genoffice/pptx-ops";
import { auditSlideFindings, buildRenderSlide, EMU_PER_PX_96 } from "@genoffice/pptx-render";

const PREVIEW_CHARS = 200;

export type OfficePptxBox = {
  readonly x: number;
  readonly y: number;
  readonly cx: number;
  readonly cy: number;
};

export type OfficePptxElement = {
  readonly id: string;
  readonly type: string;
  readonly preview: string;
  readonly x: number;
  readonly y: number;
  readonly cx: number;
  readonly cy: number;
};

export type OfficePptxIssue = {
  readonly code: string;
  readonly el: string;
  readonly message: string;
  readonly suggest?: {
    readonly op: "setTransform";
    readonly target: { readonly slide: number | string; readonly el: string };
    readonly box: OfficePptxBox;
    readonly rotDeg?: number;
  };
};

export type OfficePptxSlide = {
  readonly index: number;
  readonly notes?: string;
  readonly elements: readonly OfficePptxElement[];
  readonly issues: readonly OfficePptxIssue[];
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
    slides: opened.deck.slides.map((slide, index) => {
      const notes = clip(getSlideNotes(opened.archive, slide.path));
      const ids = new Map(slide.elements.map((element) => [element.id, elementDurableId(element) ?? element.id]));
      const rendered = buildRenderSlide(slide, opened.deck.size, {
        fitWidthPx: opened.deck.size.cx / EMU_PER_PX_96,
        slideNo: index + 1
      });
      const issues = auditSlideFindings(rendered, (id) => ids.get(id) ?? id).map((finding) => ({
        code: finding.code,
        el: finding.el,
        message: finding.message,
        ...(finding.suggest
          ? {
              suggest: {
                op: "setTransform" as const,
                target: { slide: slideDurableId(slide), el: finding.suggest.target.el },
                box: finding.suggest.box,
                ...(finding.suggest.rotDeg ? { rotDeg: finding.suggest.rotDeg } : {})
              }
            }
          : {})
      }));
      return {
        index,
        ...(notes ? { notes } : {}),
        elements: slide.elements.flatMap((element) => {
          const id = ids.get(element.id) ?? "";
          if (id.length === 0) {
            return [];
          }
          const { x, y, cx, cy } = element.transform.offset;
          return [{
            id,
            type: element.type,
            preview: clip(elementText(element)),
            x,
            y,
            cx,
            cy
          }];
        }),
        issues
      };
    })
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

const pageDeps = {
  fetchImage: async (): Promise<null> => null
};

const pagesOf = (pages: unknown, index: number): PageSpec[] => {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new OfficePptxError(index, `op ${index} (build_deck) rejected: pages must be a non-empty array`);
  }
  return pages.map((page) => {
    const parsed = parsePageSpecObject(page);
    if (!parsed.ok) {
      throw new OfficePptxError(index, `op ${index} (build_deck) rejected: ${parsed.error}`);
    }
    return parsed.spec;
  });
};

const replaceSlide = async (
  opened: OpenedPptx,
  op: Record<string, unknown>,
  index: number
): Promise<void> => {
  const slide = op.index;
  if (typeof slide !== "number" || !Number.isInteger(slide) || slide < 0 || slide >= opened.deck.slides.length) {
    throw new OfficePptxError(index, `op ${index} (replace_slide) rejected: index is out of range`);
  }
  const parsed = parsePageSpecObject(op.page);
  if (!parsed.ok) {
    throw new OfficePptxError(index, `op ${index} (replace_slide) rejected: ${parsed.error}`);
  }
  const built = await buildDeckPptx({ pages: [parsed.spec] }, pageDeps);
  const layoutFrom = opened.deck.slides[slide];
  if (layoutFrom === undefined) {
    throw new OfficePptxError(index, `op ${index} (replace_slide) rejected: index is out of range`);
  }
  const merged = await mergeSlideFromPptx(opened, built.bytes, { layoutFrom });
  if (!merged) {
    throw new OfficePptxError(index, `op ${index} (replace_slide) rejected: the page could not be merged`);
  }
  promoteSlideBackground(merged, opened.deck.size);
  const last = opened.deck.slides.length - 1;
  if (last !== slide) {
    moveSlide(opened, last, slide);
  }
  if (!deleteSlide(opened, slide + 1)) {
    throw new OfficePptxError(index, `op ${index} (replace_slide) rejected: the old slide could not be removed`);
  }
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

export const applyPptxBytes = async (
  bytes: Uint8Array,
  ops: readonly unknown[]
): Promise<{ readonly bytes: Uint8Array; readonly applied: number }> => {
  if (ops.length === 0) {
    return { bytes, applied: 0 };
  }
  const opened = await openPptx(bytes);
  const engineOps: Record<string, unknown>[] = [];
  let replaced = false;
  for (const [index, op] of ops.entries()) {
    const record = asOpRecord(op, index);
    if (record.op === "build_deck") {
      throw new OfficePptxError(index, `op ${index} (build_deck) rejected: build_deck writes a new pptx`);
    }
    if (record.op === "replace_slide") {
      await replaceSlide(opened, record, index);
      replaced = true;
      continue;
    }
    engineOps.push(toEngineOp(op, index));
  }
  if (engineOps.length === 0) {
    return replaced ? { bytes: await savePptx(opened), applied: ops.length } : { bytes, applied: 0 };
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
  const result = runTxn(opened, { ops: engineOps });
  if (!result.applied) {
    const failure = result.failures?.[0];
    throw new OfficePptxError(failure?.index ?? 0, failure?.error ?? "slide edit was rejected");
  }
  return { bytes: await savePptx(opened), applied: ops.length };
};

const bytesDiffer = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength !== right.byteLength || left.some((byte, index) => byte !== right[index]);

export const readPptxFile = async (filePath: string): Promise<OfficePptxRead> =>
  readPptxBytes(new Uint8Array(await readFile(filePath)));

export const applyPptxFile = async (
  filePath: string,
  ops: readonly unknown[]
): Promise<{ readonly applied: number; readonly written: boolean }> => {
  const pdfSource = pdfConversionSource(ops);
  if (pdfSource !== undefined) {
    if (!await absent(filePath)) {
      throw new OfficePptxError(0, "op 0 (convert_pdf) rejected: the file already exists");
    }
    const converted = await convertPdfBytes(new Uint8Array(await readFile(pdfSource)), "pptx");
    const rest = ops.slice(1);
    const result = rest.length === 0 ? { bytes: converted, applied: 0 } : await applyPptxBytes(converted, rest);
    await writeFile(filePath, result.bytes);
    return { applied: result.applied + 1, written: true };
  }
  const first = asOpRecord(ops[0] ?? {}, 0);
  if (ops.length > 0 && first.op === "build_deck") {
    if (!await absent(filePath)) {
      throw new OfficePptxError(0, "op 0 (build_deck) rejected: the file already exists");
    }
    const built = await buildDeckPptx({ pages: pagesOf(first.pages, 0) }, pageDeps);
    const rest = ops.slice(1);
    const result = rest.length === 0
      ? { bytes: built.bytes, applied: 0 }
      : await applyPptxBytes(built.bytes, rest);
    await writeFile(filePath, result.bytes);
    return { applied: result.applied + 1, written: true };
  }
  const original = new Uint8Array(await readFile(filePath));
  const result = await applyPptxBytes(original, ops);
  const written = bytesDiffer(original, result.bytes);
  if (written) {
    await writeFile(filePath, result.bytes);
  }
  return { applied: result.applied, written };
};
