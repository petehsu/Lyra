import { nativeImage } from "electron";
import type { WorkbenchBrowserAgentElementBounds as Rect } from "../types";
import type { VisualCell, VisualMark } from "./visual-scene-types";
import type { VisualRegionChange } from "./visual-scene-evidence";

// Small deterministic bitmap glyphs keep labels sharp after downsampling. No
// DOM overlay, font service, OCR model or second screenshot is involved.
const glyphs: Record<string, string> = {
  "0": "01110100011000110101100011000101110",
  "1": "00100011000010000100001000010001110",
  "2": "01110100010000100010001000100011111",
  "3": "11110000010000101110000010000111110",
  "4": "00010001100101010010111110001000010",
  "5": "11111100001000011110000010000111110",
  "6": "01110100001000011110100011000101110",
  "7": "11111000010001000100010000100001000",
  "8": "01110100011000101110100011000101110",
  "9": "01110100011000101111000010000101110",
  a: "01110100011000111111100011000110001",
  b: "11110100011000111110100011000111110",
  c: "01111100001000010000100001000001111",
  d: "11110100011000110001100011000111110",
  e: "11111100001000011110100001000011111",
  f: "11111100001000011110100001000010000",
  g: "01111100001000010111100011000101111",
  h: "10001100011000111111100011000110001",
  j: "00111000100001000010000101001001100",
  k: "10001100101010011000101001001010001",
  m: "10001110111010110101100011000110001",
  n: "10001110011010110011100011000110001",
  p: "11110100011000111110100001000010000",
  q: "01110100011000110001101011001001101",
  r: "11110100011000111110101001001010001",
  s: "01111100001000001110000010000111110",
  t: "11111001000010000100001000010000100",
  u: "10001100011000110001100011000101110",
  v: "10001100011000110001100010101000100",
  w: "10001100011000110101101011101110001",
  x: "10001100010101000100010101000110001",
  y: "10001100010101000100001000010000100",
  z: "11111000010001000100010001000011111",
};
const alphabet = "123456789abcdefghjkmnpqrstuvwxyz";
export const visualMarkId = (ordinal: number): string => {
  let result = "";
  for (let n = ordinal; n >= 0; n = Math.floor(n / alphabet.length) - 1)
    result = alphabet[n % alphabet.length] + result;
  return result;
};
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

export const renderVisualScene = (input: {
  imageBase64: string;
  viewportWidth: number;
  viewportHeight: number;
  clip: Rect;
  marks: readonly VisualMark[];
  maxDimension?: number;
  region?: string;
  zoom?: number;
  changes?: readonly VisualRegionChange[];
  focus?: { mark: string; cell: VisualCell };
}) => {
  let image = nativeImage.createFromBuffer(
    Buffer.from(input.imageBase64, "base64"),
  );
  const original = image.getSize();
  if (!original.width || !original.height)
    throw new Error("Empty browser screenshot");
  const sx = original.width / input.viewportWidth,
    sy = original.height / input.viewportHeight;
  const x = Math.max(0, Math.floor(input.clip.x * sx)),
    y = Math.max(0, Math.floor(input.clip.y * sy));
  const width = Math.min(original.width - x, Math.ceil(input.clip.width * sx));
  const height = Math.min(
    original.height - y,
    Math.ceil(input.clip.height * sy),
  );
  if (width < 1 || height < 1)
    throw new Error("Visual region is outside the viewport");
  image = image.crop({ x, y, width, height });
  const scale = Math.min(
    input.zoom ?? 1,
    (input.maxDimension ?? 2000) / Math.max(width, height),
  );
  if (scale !== 1)
    image = image.resize({
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      quality: "best",
    });
  let size = image.getSize(),
    bitmap = image.toBitmap();
  let clip = { x: x / sx, y: y / sy, width: width / sx, height: height / sy };
  if (input.marks.some((mark) => mark.grid)) {
    // A gutter keeps axes out of the underlying content even at viewport edges.
    const padding = 32,
      padded = {
        width: size.width + padding * 2,
        height: size.height + padding * 2,
      };
    const bytes = Buffer.alloc(padded.width * padded.height * 4, 245);
    for (let i = 3; i < bytes.length; i += 4) bytes[i] = 255;
    for (let row = 0; row < size.height; row++)
      bitmap.copy(
        bytes,
        ((row + padding) * padded.width + padding) * 4,
        row * size.width * 4,
        (row + 1) * size.width * 4,
      );
    clip = {
      x: clip.x - (padding * clip.width) / size.width,
      y: clip.y - (padding * clip.height) / size.height,
      width: (clip.width * padded.width) / size.width,
      height: (clip.height * padded.height) / size.height,
    };
    size = padded;
    bitmap = bytes;
  }
  const pixel = (px: number, py: number, color: readonly number[]) => {
    px = Math.round(px);
    py = Math.round(py);
    if (px < 0 || py < 0 || px >= size.width || py >= size.height) return;
    const at = (py * size.width + px) * 4;
    bitmap[at] = color[2]!;
    bitmap[at + 1] = color[1]!;
    bitmap[at + 2] = color[0]!;
    bitmap[at + 3] = 255;
  };
  const fill = (r: Rect, color: readonly number[]) => {
    for (
      let py = Math.max(0, Math.floor(r.y));
      py < Math.min(size.height, r.y + r.height);
      py++
    )
      for (
        let px = Math.max(0, Math.floor(r.x));
        px < Math.min(size.width, r.x + r.width);
        px++
      )
        pixel(px, py, color);
  };
  const placed: Rect[] = [];
  const drawText = (text: string, x: number, y: number, scale = 2) => {
    [...text].forEach((char, i) => {
      const glyph = glyphs[char];
      if (!glyph) return;
      for (let gy = 0; gy < 7; gy++)
        for (let gx = 0; gx < 5; gx++)
          if (glyph[gy * 5 + gx] === "1")
            fill(
              {
                x: x + i * 6 * scale + gx * scale,
                y: y + gy * scale,
                width: scale,
                height: scale,
              },
              [255, 255, 255],
            );
    });
  };
  const marks = input.marks.map((mark) => {
    const b = mark.bounds;
    const bounds = {
      x: ((b.x - clip.x) * size.width) / clip.width,
      y: ((b.y - clip.y) * size.height) / clip.height,
      width: (b.width * size.width) / clip.width,
      height: (b.height * size.height) / clip.height,
    };
    const color = mark.disabled
      ? [140, 140, 140]
      : mark.kind === "region"
        ? [255, 190, 30]
        : [25, 155, 255];
    if (mark.grid) {
      const outline = (cell: VisualCell, color: readonly number[]) => {
        const grid = mark.grid!;
        const cx = bounds.x + grid.xs[cell.column - 1]! * bounds.width;
        const cy = bounds.y + grid.ys[cell.row - 1]! * bounds.height;
        const halfX = (grid.xs[1]! - grid.xs[0]!) * bounds.width * 0.45;
        const halfY = (grid.ys[1]! - grid.ys[0]!) * bounds.height * 0.45;
        // Outlines leave the observed pixels at the cell center intact.
        for (let dx = -halfX; dx <= halfX; dx++) {
          pixel(cx + dx, cy - halfY, color);
          pixel(cx + dx, cy + halfY, color);
        }
        for (let dy = -halfY; dy <= halfY; dy++) {
          pixel(cx - halfX, cy + dy, color);
          pixel(cx + halfX, cy + dy, color);
        }
      };
      const changed = input.changes?.find(
        (change) => change.mark === mark.mark,
      );
      if (changed && changed.changedCellCount <= 12)
        for (const cell of changed.changedCells) outline(cell, [220, 70, 170]);
      if (input.focus?.mark === mark.mark)
        outline(input.focus.cell, [0, 210, 220]);
    }
    const left = Math.max(0, Math.floor(bounds.x)),
      top = Math.max(0, Math.floor(bounds.y));
    const right = Math.min(size.width - 1, Math.ceil(bounds.x + bounds.width)),
      bottom = Math.min(size.height - 1, Math.ceil(bounds.y + bounds.height));
    for (let px = left; px <= right; px++) {
      pixel(px, top, color);
      pixel(px, bottom, color);
    }
    for (let py = top; py <= bottom; py++) {
      pixel(left, py, color);
      pixel(right, py, color);
    }
    const labelWidth = mark.mark.length * 12 + 6,
      labelHeight = 18;
    const candidates = (
      mark.mark === input.region && mark.grid
        ? [[2, 2]]
        : mark.grid
          ? [[left - labelWidth - 2, top - labelHeight - 6]]
          : [
              [left, top - labelHeight],
              [right - labelWidth, top - labelHeight],
              [left, bottom + 1],
              [right + 1, top],
              [left, top],
            ]
    ).map(([cx, cy]) => ({
      x: Math.max(0, Math.min(size.width - labelWidth, cx!)),
      y: Math.max(0, Math.min(size.height - labelHeight, cy!)),
      width: labelWidth,
      height: labelHeight,
    }));
    candidates.sort((a, b) =>
      placed.reduce((s, r) => s + overlap(a, r) - overlap(b, r), 0),
    );
    const label = candidates[0]!;
    placed.push(label);
    fill(label, [10, 15, 20]);
    drawText(mark.mark, label.x + 3, label.y + 2);
    if (mark.grid) {
      const { xs, ys } = mark.grid;
      const spacing = Math.min(
        (xs[1]! - xs[0]!) * bounds.width,
        (ys[1]! - ys[0]!) * bounds.height,
      );
      const scale = spacing >= 30 ? 2 : 1;
      const badge = (value: number, x: number, y: number) => {
        const text = String(value),
          w = text.length * 6 * scale + 4,
          h = 7 * scale + 4;
        fill({ x: x - w / 2, y: y - h / 2, width: w, height: h }, [10, 15, 20]);
        drawText(text, x - w / 2 + 2, y - h / 2 + 2, scale);
      };
      // Axes live outside the region, not on stones or cell centers.
      xs.forEach((p, i) => {
        const x = bounds.x + p * bounds.width;
        if (x >= 32 && x <= size.width - 32)
          badge(
            i + 1,
            x,
            mark.mark === input.region ? 18 : Math.max(18, bounds.y - 12),
          );
      });
      ys.forEach((p, i) => {
        const y = bounds.y + p * bounds.height;
        if (y >= 32 && y <= size.height - 32)
          badge(
            i + 1,
            mark.mark === input.region ? 16 : Math.max(16, bounds.x - 16),
            y,
          );
      });
    }
    return {
      mark: mark.mark,
      kind: mark.kind,
      role: mark.role,
      disabled: mark.disabled,
      ...(mark.interactionEvidence ? { interactionEvidence: mark.interactionEvidence } : {}),
      bounds,
      ...(mark.grid
        ? {
            grid: {
              rows: mark.grid.ys.length,
              columns: mark.grid.xs.length,
              source: mark.grid.source,
              points: mark.grid.xs.length * mark.grid.ys.length,
              address:
                "cell={row,column}; 1-based; rows downward, columns rightward",
              anchor:
                mark.grid.source === "dom"
                  ? "real control centers"
                  : "visible line intersections; clickability unverified",
            },
          }
        : {}),
    };
  });
  image = nativeImage.createFromBitmap(bitmap, size);
  return {
    imageBase64: image.toPNG().toString("base64"),
    ...size,
    clip,
    marks,
    downsampled: scale < 1,
    magnification: scale,
    highlighted: marks.length > 0,
  };
};
