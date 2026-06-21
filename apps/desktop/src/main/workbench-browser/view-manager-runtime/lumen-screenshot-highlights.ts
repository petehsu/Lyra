import { nativeImage, type NativeImage } from "electron";

import type {
  LumenScreenshotHighlightRegion,
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserAgentElementBounds
} from "../types";

export type { LumenScreenshotHighlightRegion };
import { LUMEN_VISION_MAX_DIMENSION_PX } from "./lumen-runtime-guards";

type RgbaColor = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
};

const HIGHLIGHT_COLORS: readonly RgbaColor[] = [
  { r: 255, g: 64, b: 64 },
  { r: 64, g: 160, b: 255 },
  { r: 72, g: 220, b: 120 },
  { r: 255, g: 196, b: 48 },
  { r: 196, g: 96, b: 255 }
];

const setPixelBgra = (
  buffer: Buffer,
  width: number,
  x: number,
  y: number,
  color: RgbaColor
): void => {
  if (x < 0 || y < 0 || x >= width) {
    return;
  }
  const idx = (y * width + x) * 4;
  if (idx < 0 || idx + 3 >= buffer.length) {
    return;
  }
  buffer[idx] = color.b;
  buffer[idx + 1] = color.g;
  buffer[idx + 2] = color.r;
  buffer[idx + 3] = 255;
};

const drawRectOutline = (
  buffer: Buffer,
  width: number,
  height: number,
  rect: WorkbenchBrowserAgentElementBounds,
  color: RgbaColor,
  thickness = 3
): void => {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width - 1, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(height - 1, Math.ceil(rect.y + rect.height));
  for (let offset = 0; offset < thickness; offset += 1) {
    for (let x = x0; x <= x1; x += 1) {
      setPixelBgra(buffer, width, x, y0 + offset, color);
      setPixelBgra(buffer, width, x, y1 - offset, color);
    }
    for (let y = y0; y <= y1; y += 1) {
      setPixelBgra(buffer, width, x0 + offset, y, color);
      setPixelBgra(buffer, width, x1 - offset, y, color);
    }
  }
};

export const cssBoundsToDeviceBounds = (
  bounds: WorkbenchBrowserAgentElementBounds,
  options: {
    readonly dpr: number;
    readonly scrollX: number;
    readonly scrollY: number;
    readonly viewOffsetX?: number;
    readonly viewOffsetY?: number;
  }
): WorkbenchBrowserAgentElementBounds => {
  const dpr = Math.max(0.1, options.dpr);
  const offsetX = options.viewOffsetX ?? 0;
  const offsetY = options.viewOffsetY ?? 0;
  return {
    x: Math.round((bounds.x - options.scrollX - offsetX) * dpr),
    y: Math.round((bounds.y - options.scrollY - offsetY) * dpr),
    width: Math.max(1, Math.round(bounds.width * dpr)),
    height: Math.max(1, Math.round(bounds.height * dpr))
  };
};

export const buildHighlightRegionsFromElements = (
  elements: readonly WorkbenchBrowserAgentElement[],
  options: {
    readonly dpr: number;
    readonly scrollX: number;
    readonly scrollY: number;
    readonly viewOffsetX?: number;
    readonly viewOffsetY?: number;
    readonly targetRefs?: readonly string[];
    readonly maxRegions?: number;
  }
): readonly LumenScreenshotHighlightRegion[] => {
  const allowed = options.targetRefs === undefined
    ? null
    : new Set(options.targetRefs);
  const maxRegions = Math.max(1, Math.min(options.maxRegions ?? 24, 48));
  return elements
    .filter((element) =>
      element.discoveryScope !== "visual"
      && element.discoveryScope !== "coordinate"
      && element.disabled === false
      && element.visibility?.visible !== false
      && element.visibility?.covered !== true
      && (allowed === null || allowed.has(element.targetRef))
    )
    .slice(0, maxRegions)
    .map((element) => ({
      targetRef: element.targetRef,
      elementId: element.id,
      label: element.label,
      role: element.role,
      bounds: element.bounds,
      deviceBounds: cssBoundsToDeviceBounds(element.bounds, options)
    }));
};

export const downsampleNativeImageForVision = (
  image: NativeImage,
  maxDimension: number = LUMEN_VISION_MAX_DIMENSION_PX
): NativeImage => {
  const size = image.getSize();
  const longest = Math.max(size.width, size.height);
  if (longest <= maxDimension) {
    return image;
  }
  const scale = maxDimension / longest;
  return image.resize({
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
    quality: "best"
  });
};

export const applyHighlightRegionsToPngBase64 = (
  imageBase64: string,
  regions: readonly LumenScreenshotHighlightRegion[]
): {
  readonly imageBase64: string;
  readonly width: number;
  readonly height: number;
  readonly highlighted: boolean;
} => {
  if (regions.length === 0) {
    const image = nativeImage.createFromBuffer(Buffer.from(imageBase64, "base64"));
    const size = image.getSize();
    return {
      imageBase64,
      width: size.width,
      height: size.height,
      highlighted: false
    };
  }
  const image = nativeImage.createFromBuffer(Buffer.from(imageBase64, "base64"));
  const size = image.getSize();
  const bitmap = image.toBitmap();
  regions.forEach((region, index) => {
    drawRectOutline(
      bitmap,
      size.width,
      size.height,
      region.deviceBounds,
      HIGHLIGHT_COLORS[index % HIGHLIGHT_COLORS.length]!
    );
  });
  const highlighted = nativeImage.createFromBitmap(bitmap, {
    width: size.width,
    height: size.height
  });
  const png = highlighted.toPNG();
  return {
    imageBase64: png.toString("base64"),
    width: size.width,
    height: size.height,
    highlighted: true
  };
};

export const prepareVisionCapturePng = (
  imageBase64: string,
  options?: {
    readonly highlightRegions?: readonly LumenScreenshotHighlightRegion[];
    readonly maxDimension?: number;
  }
): {
  readonly imageBase64: string;
  readonly width: number;
  readonly height: number;
  readonly highlighted: boolean;
  readonly downsampled: boolean;
} => {
  let image = nativeImage.createFromBuffer(Buffer.from(imageBase64, "base64"));
  let downsampled = false;
  const maxDimension = options?.maxDimension ?? LUMEN_VISION_MAX_DIMENSION_PX;
  const before = image.getSize();
  image = downsampleNativeImageForVision(image, maxDimension);
  const after = image.getSize();
  downsampled = before.width !== after.width || before.height !== after.height;
  const base64 = image.toPNG().toString("base64");
  const highlighted = applyHighlightRegionsToPngBase64(
    base64,
    (options?.highlightRegions ?? []).map((region) => ({
      ...region,
      deviceBounds: {
        x: Math.round(region.deviceBounds.x * (after.width / before.width)),
        y: Math.round(region.deviceBounds.y * (after.height / before.height)),
        width: Math.max(1, Math.round(region.deviceBounds.width * (after.width / before.width))),
        height: Math.max(1, Math.round(region.deviceBounds.height * (after.height / before.height)))
      }
    }))
  );
  return {
    ...highlighted,
    downsampled
  };
};