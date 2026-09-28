import { createHash } from "node:crypto";
import { nativeImage } from "electron";
import type { VisualCell, VisualMark } from "./visual-scene-types";

type RegionSample = {
  key: string;
  width: number;
  height: number;
  pixels: Buffer;
  cells: Buffer[];
  columns: number;
  rows: number;
};
export type VisualRegionChange = {
  mark: string;
  comparison: "baseline" | "changed" | "unchanged" | "geometry_changed";
  changedCells: VisualCell[];
  changedCellCount: number;
};
export type VisualEvidence = {
  fingerprint: string;
  previousCaptureId?: string;
  regions: VisualRegionChange[];
  basis: string;
};
const digest = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");

// A bounded visual difference, never a stone/object classifier or business-state reader.
const visiblyDifferent = (a: Buffer, b: Buffer) => {
  if (a.length !== b.length) return true;
  let changed = 0,
    total = 0;
  for (let i = 0; i < a.length; i++) {
    const delta = Math.abs(a[i]! - b[i]!);
    total += delta;
    if (delta >= 18) changed++;
  }
  return total / a.length >= 5 && changed / a.length >= 0.04;
};

// Inspect local tiles so a small drawing stroke is not lost in a large plain canvas.
const locallyDifferent = (a: Buffer, b: Buffer, width: number) => {
  if (a.length !== b.length) return true;
  const height = a.length / (width * 3);
  for (let y = 0; y < height; y += 12)
    for (let x = 0; x < width; x += 12) {
      let changed = 0,
        total = 0,
        count = 0;
      for (let py = y; py < Math.min(height, y + 12); py++)
        for (let px = x; px < Math.min(width, x + 12); px++)
          for (let c = 0; c < 3; c++) {
            const at = (py * width + px) * 3 + c,
              delta = Math.abs(a[at]! - b[at]!);
            total += delta;
            count++;
            if (delta >= 18) changed++;
          }
      if (total / count >= 5 && changed / count >= 0.04) return true;
    }
  return false;
};

export const createVisualEvidenceTracker = () => {
  const histories = new Map<
    string,
    {
      documentId: string;
      captureId: string;
      bytes: number;
      regions: Map<string, RegionSample>;
    }
  >();
  const clear = (tabId: string) => {
    for (const scope of histories.keys())
      if (scope.startsWith(tabId + "\0")) histories.delete(scope);
  };
  return {
    clear,
    dispose: () => histories.clear(),
    observe: (
      scope: string,
      documentId: string,
      captureId: string,
      imageBase64: string,
      viewport: { width: number; height: number },
      marks: readonly VisualMark[],
    ): VisualEvidence => {
      const image = nativeImage.createFromBuffer(
        Buffer.from(imageBase64, "base64"),
      );
      const size = image.getSize();
      const old = histories.get(scope);
      const previous = old?.documentId === documentId ? old : undefined;
      const regions = new Map<string, RegionSample>();
      const changes: VisualRegionChange[] = [];
      for (const mark of marks
        .filter((mark) => mark.kind === "region")
        .slice(0, 8)) {
        const b = mark.bounds;
        // A clipped region is not comparable with a complete previous region.
        if (
          b.x < 0 ||
          b.y < 0 ||
          b.x + b.width > viewport.width + 1 ||
          b.y + b.height > viewport.height + 1
        )
          continue;
        const x = Math.max(0, Math.floor((b.x * size.width) / viewport.width));
        const y = Math.max(
          0,
          Math.floor((b.y * size.height) / viewport.height),
        );
        const width = Math.min(
          size.width - x,
          Math.ceil((b.width * size.width) / viewport.width),
        );
        const height = Math.min(
          size.height - y,
          Math.ceil((b.height * size.height) / viewport.height),
        );
        if (width < 1 || height < 1) continue;
        const columns = mark.grid?.xs.length ?? 0,
          rows = mark.grid?.ys.length ?? 0;
        const sw = columns ? Math.min(720, columns * 12) : 160;
        const sh = rows
          ? Math.min(720, rows * 12)
          : Math.max(1, Math.round((160 * height) / width));
        const bitmap = image
          .crop({ x, y, width, height })
          .resize({ width: sw, height: Math.min(sh, 320), quality: "best" });
        const measured = bitmap.getSize(),
          bytes = bitmap.toBitmap();
        const pixels = Buffer.alloc(measured.width * measured.height * 3);
        for (let i = 0; i < pixels.length / 3; i++)
          for (let c = 0; c < 3; c++) pixels[i * 3 + c] = bytes[i * 4 + c]!;
        const cells: Buffer[] = [];
        if (mark.grid)
          for (const cy of mark.grid.ys)
            for (const cx of mark.grid.xs) {
              const patch = Buffer.alloc(9 * 9 * 3);
              const dx = (mark.grid.xs[1]! - mark.grid.xs[0]!) * 0.8;
              const dy = (mark.grid.ys[1]! - mark.grid.ys[0]!) * 0.8;
              for (let py = 0; py < 9; py++)
                for (let px = 0; px < 9; px++) {
                  const atX = Math.min(
                    measured.width - 1,
                    Math.max(
                      0,
                      Math.round((cx + (px / 8 - 0.5) * dx) * measured.width),
                    ),
                  );
                  const atY = Math.min(
                    measured.height - 1,
                    Math.max(
                      0,
                      Math.round((cy + (py / 8 - 0.5) * dy) * measured.height),
                    ),
                  );
                  pixels.copy(
                    patch,
                    (py * 9 + px) * 3,
                    (atY * measured.width + atX) * 3,
                    (atY * measured.width + atX) * 3 + 3,
                  );
                }
              cells.push(patch);
            }
        const sample: RegionSample = {
          key: mark.documentId + "\0" + mark.targetRef,
          width: b.width,
          height: b.height,
          pixels,
          cells,
          columns,
          rows,
        };
        const prior = previous?.regions.get(sample.key);
        const compatible =
          prior &&
          prior.columns === columns &&
          prior.rows === rows &&
          Math.abs(prior.width - b.width) < 1 &&
          Math.abs(prior.height - b.height) < 1;
        const changedCells: VisualCell[] = [];
        if (compatible)
          cells.forEach((cell, i) => {
            if (visiblyDifferent(prior.cells[i]!, cell))
              changedCells.push({
                row: Math.floor(i / columns) + 1,
                column: (i % columns) + 1,
              });
          });
        const changed =
          compatible &&
          (cells.length
            ? changedCells.length > 0
            : locallyDifferent(prior.pixels, pixels, measured.width));
        // Retain the last meaningful pixels to avoid accumulated sub-threshold changes being hidden.
        if (compatible && !changed) {
          sample.pixels = prior.pixels;
          sample.cells = prior.cells;
        }
        regions.set(sample.key, sample);
        changes.push({
          mark: mark.mark,
          comparison: !prior
            ? "baseline"
            : !compatible
              ? "geometry_changed"
              : changed
                ? "changed"
                : "unchanged",
          changedCells: changedCells.slice(0, 40),
          changedCellCount: changedCells.length,
        });
      }
      const fingerprint = digest(
        regions.size
          ? [...regions.values()]
              .map(
                (r) =>
                  r.key +
                  ":" +
                  [r.width, r.height, r.columns, r.rows].join(",") +
                  ":" +
                  digest(r.pixels),
              )
              .join("|")
          : Buffer.from(imageBase64, "base64"),
      );
      const bytes = [...regions.values()].reduce(
        (sum, region) =>
          sum +
          region.pixels.length +
          region.cells.reduce((n, cell) => n + cell.length, 0),
        0,
      );
      histories.delete(scope);
      histories.set(scope, { documentId, captureId, regions, bytes });
      let totalBytes = [...histories.values()].reduce(
        (sum, history) => sum + history.bytes,
        0,
      );
      while (
        histories.size > 32 ||
        (totalBytes > 16 * 1024 * 1024 && histories.size > 1)
      ) {
        totalBytes -= histories.values().next().value!.bytes;
        histories.delete(histories.keys().next().value!);
      }
      return {
        fingerprint,
        ...(previous ? { previousCaptureId: previous.captureId } : {}),
        regions: changes,
        basis:
          "Captured pixels compared with the previous observation of this document, not game state. Changed pixels do not prove acceptance or turn completion; unchanged pixels do not prove failure.",
      };
    },
  };
};
