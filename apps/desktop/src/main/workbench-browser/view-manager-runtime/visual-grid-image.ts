import { nativeImage } from "electron";
import type { WorkbenchBrowserAgentElementBounds as Rect } from "../types";
import type { VisualGrid } from "./visual-scene-types";

const regularRun = (
  weights: readonly number[],
  length: number,
): number[] | null => {
  const bands: number[][] = [];
  weights.forEach((weight, position) => {
    if (weight < 0.4) return;
    const last = bands.at(-1);
    if (last && position - last.at(-1)! <= 3) last.push(position);
    else bands.push([position]);
  });
  const peaks = bands
    .filter((band) => band.length <= 8)
    .map(
      (band) =>
        band.reduce((sum, p) => sum + p * weights[p]!, 0) /
        band.reduce((sum, p) => sum + weights[p]!, 0),
    );
  if (peaks.length > 100) return null;
  let best: number[] = [];
  for (let start = 0; start + 3 < peaks.length; start++) {
    for (
      let end = start + Math.max(3, best.length);
      end < Math.min(peaks.length, start + 60);
      end++
    ) {
      // Fit the whole span: the first interval can be rounded by rasterization,
      // and accumulating that error would reject legitimate fractional spacing.
      const step = (peaks[end]! - peaks[start]!) / (end - start);
      if (step < 10) continue;
      const run = peaks.slice(start, end + 1);
      if (
        run.every(
          (p, i) =>
            Math.abs(p - peaks[start]! - step * i) <=
            Math.max(1.5, step * 0.04),
        )
      )
        best = run;
    }
  }
  return best.length >= 4 &&
    best.length <= 60 &&
    best.at(-1)! - best[0]! >= length * 0.65
    ? best
    : null;
};

/** Detect visible line crossings from captured pixels; never reads canvas JS state. */
export const detectImageGrid = (
  imageBase64: string,
  viewport: { width: number; height: number },
  bounds: Rect,
): VisualGrid | undefined => {
  if (
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.x + bounds.width > viewport.width + 1 ||
    bounds.y + bounds.height > viewport.height + 1 ||
    bounds.width < 80 ||
    bounds.height < 80
  )
    return undefined;
  const image = nativeImage.createFromBuffer(
      Buffer.from(imageBase64, "base64"),
    ),
    original = image.getSize();
  const sx = original.width / viewport.width,
    sy = original.height / viewport.height;
  const x = Math.max(0, Math.floor(bounds.x * sx)),
    y = Math.max(0, Math.floor(bounds.y * sy));
  const width = Math.min(original.width - x, Math.ceil(bounds.width * sx)),
    height = Math.min(original.height - y, Math.ceil(bounds.height * sy));
  if (width < 1 || height < 1) return undefined;
  const cropped = image.crop({ x, y, width, height });
  const scale = Math.min(1, 640 / Math.max(width, height));
  const small =
    scale < 1
      ? cropped.resize({
          width: Math.round(width * scale),
          height: Math.round(height * scale),
          quality: "best",
        })
      : cropped;
  const size = small.getSize(),
    bitmap = small.toBitmap(),
    luminance = new Float32Array(size.width * size.height);
  for (let i = 0; i < luminance.length; i++)
    luminance[i] =
      bitmap[i * 4]! * 0.114 +
      bitmap[i * 4 + 1]! * 0.587 +
      bitmap[i * 4 + 2]! * 0.299;
  const profile = (vertical: boolean) => {
    const count = vertical ? size.width : size.height,
      span = vertical ? size.height : size.width;
    const values = Array<number>(count).fill(0);
    const pixel = (at: number, along: number) =>
      luminance[vertical ? along * size.width + at : at * size.width + along]!;
    for (let at = 2; at < count - 2; at++) {
      let found = 0,
        samples = 0;
      for (let along = 2; along < span - 2; along += 2) {
        const before = pixel(at - 2, along),
          after = pixel(at + 2, along),
          center = pixel(at, along);
        if (
          Math.abs(before - after) < 24 &&
          Math.abs(center - (before + after) / 2) > 14
        )
          found++;
        samples++;
      }
      values[at] = found / Math.max(1, samples);
    }
    return regularRun(values, count);
  };
  const xs = profile(true),
    ys = profile(false);
  if (!xs || !ys) return undefined;
  return {
    source: "image-lines",
    xs: xs.map(
      (p) =>
        ((x + ((p + 0.5) * width) / size.width) / sx - bounds.x) / bounds.width,
    ),
    ys: ys.map(
      (p) =>
        ((y + ((p + 0.5) * height) / size.height) / sy - bounds.y) /
        bounds.height,
    ),
  };
};

export const sameGridGeometry = (
  before: VisualGrid,
  after: VisualGrid | undefined,
): boolean =>
  !!after &&
  before.xs.length === after.xs.length &&
  before.ys.length === after.ys.length &&
  before.xs.every((x, i) => Math.abs(x - after.xs[i]!) < 0.004) &&
  before.ys.every((y, i) => Math.abs(y - after.ys[i]!) < 0.004);
