import { nativeImage, type NativeImage } from "electron";
import jsQR from "jsqr";

import type { WorkbenchBrowserAgentElementBounds } from "../types";

export type WorkbenchBrowserQrCorner = {
  readonly x: number;
  readonly y: number;
};

export type WorkbenchBrowserDetectedQrCode = {
  readonly payload: string;
  readonly format: "qr";
  readonly bounds: WorkbenchBrowserAgentElementBounds;
  readonly center: WorkbenchBrowserQrCorner;
  readonly corners: {
    readonly topLeft: WorkbenchBrowserQrCorner;
    readonly topRight: WorkbenchBrowserQrCorner;
    readonly bottomLeft: WorkbenchBrowserQrCorner;
    readonly bottomRight: WorkbenchBrowserQrCorner;
  };
  readonly confidence: number;
};

const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

const normalizeBounds = (
  left: number,
  top: number,
  right: number,
  bottom: number,
  imageWidth: number,
  imageHeight: number,
  offsetX = 0,
  offsetY = 0
): WorkbenchBrowserAgentElementBounds => {
  const x = clampInt(Math.min(left, right), 0, imageWidth - 1);
  const y = clampInt(Math.min(top, bottom), 0, imageHeight - 1);
  const maxX = clampInt(Math.max(left, right), x + 1, imageWidth);
  const maxY = clampInt(Math.max(top, bottom), y + 1, imageHeight);
  return {
    x: x + offsetX,
    y: y + offsetY,
    width: Math.max(1, maxX - x),
    height: Math.max(1, maxY - y)
  };
};

const offsetCorner = (
  corner: WorkbenchBrowserQrCorner,
  offsetX: number,
  offsetY: number
): WorkbenchBrowserQrCorner => ({
  x: clampInt(corner.x + offsetX, 0, Number.MAX_SAFE_INTEGER),
  y: clampInt(corner.y + offsetY, 0, Number.MAX_SAFE_INTEGER)
});

const bgraBitmapToRgba = (
  bitmap: Buffer,
  width: number,
  height: number
): Uint8ClampedArray => {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const pixelCount = width * height;
  for (let index = 0; index < pixelCount; index += 1) {
    const source = index * 4;
    const target = source;
    rgba[target] = bitmap[source + 2] ?? 0;
    rgba[target + 1] = bitmap[source + 1] ?? 0;
    rgba[target + 2] = bitmap[source] ?? 0;
    rgba[target + 3] = 255;
  }
  return rgba;
};

const readNativeImageRgba = (
  image: NativeImage
): { readonly rgba: Uint8ClampedArray; readonly width: number; readonly height: number } => {
  const { width, height } = image.getSize();
  const rgba = bgraBitmapToRgba(image.toBitmap(), width, height);
  return { rgba, width, height };
};

const eraseQrRegion = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  location: NonNullable<ReturnType<typeof jsQR>>["location"]
): void => {
  const xs = [
    location.topLeftCorner.x,
    location.topRightCorner.x,
    location.bottomRightCorner.x,
    location.bottomLeftCorner.x
  ];
  const ys = [
    location.topLeftCorner.y,
    location.topRightCorner.y,
    location.bottomRightCorner.y,
    location.bottomLeftCorner.y
  ];
  const left = clampInt(Math.min(...xs) - 8, 0, width - 1);
  const right = clampInt(Math.max(...xs) + 8, left + 1, width);
  const top = clampInt(Math.min(...ys) - 8, 0, height - 1);
  const bottom = clampInt(Math.max(...ys) + 8, top + 1, height);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = (y * width + x) * 4;
      rgba[index] = 255;
      rgba[index + 1] = 255;
      rgba[index + 2] = 255;
      rgba[index + 3] = 255;
    }
  }
};

const decodeQrFromRgba = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number
): WorkbenchBrowserDetectedQrCode | null => {
  const result = jsQR(rgba, width, height, { inversionAttempts: "attemptBoth" });
  if (result === null || result.data.trim().length === 0) {
    return null;
  }
  const bounds = normalizeBounds(
    result.location.topLeftCorner.x,
    result.location.topLeftCorner.y,
    result.location.bottomRightCorner.x,
    result.location.bottomRightCorner.y,
    width,
    height,
    offsetX,
    offsetY
  );
  return {
    payload: result.data,
    format: "qr",
    bounds,
    center: {
      x: bounds.x + Math.round(bounds.width / 2),
      y: bounds.y + Math.round(bounds.height / 2)
    },
    corners: {
      topLeft: offsetCorner(result.location.topLeftCorner, offsetX, offsetY),
      topRight: offsetCorner(result.location.topRightCorner, offsetX, offsetY),
      bottomLeft: offsetCorner(result.location.bottomLeftCorner, offsetX, offsetY),
      bottomRight: offsetCorner(result.location.bottomRightCorner, offsetX, offsetY)
    },
    confidence: 0.94
  };
};

const isDuplicateQrCode = (
  codes: readonly WorkbenchBrowserDetectedQrCode[],
  candidate: WorkbenchBrowserDetectedQrCode
): boolean =>
  codes.some(
    (code) =>
      code.payload === candidate.payload
      || (
        Math.abs(code.center.x - candidate.center.x) < 24
        && Math.abs(code.center.y - candidate.center.y) < 24
      )
  );

const extractRgbaRegion = (
  rgba: Uint8ClampedArray,
  imageWidth: number,
  x: number,
  y: number,
  regionWidth: number,
  regionHeight: number
): Uint8ClampedArray => {
  const region = new Uint8ClampedArray(regionWidth * regionHeight * 4);
  for (let row = 0; row < regionHeight; row += 1) {
    for (let col = 0; col < regionWidth; col += 1) {
      const sourceIndex = ((y + row) * imageWidth + (x + col)) * 4;
      const targetIndex = (row * regionWidth + col) * 4;
      region[targetIndex] = rgba[sourceIndex] ?? 0;
      region[targetIndex + 1] = rgba[sourceIndex + 1] ?? 0;
      region[targetIndex + 2] = rgba[sourceIndex + 2] ?? 0;
      region[targetIndex + 3] = rgba[sourceIndex + 3] ?? 255;
    }
  }
  return region;
};

const scanQrCodesInTiles = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  maxCodes: number,
  existing: readonly WorkbenchBrowserDetectedQrCode[]
): WorkbenchBrowserDetectedQrCode[] => {
  const codes = [...existing];
  const minTile = 96;
  const tileWidth = width <= minTile * 2
    ? width
    : clampInt(
        Math.min(width, Math.max(minTile, Math.round(width * 0.55))),
        minTile,
        width
      );
  const tileHeight = height <= Math.round(minTile * 1.5)
    ? height
    : clampInt(
        Math.min(height, Math.max(minTile, Math.round(height * 0.85))),
        minTile,
        height
      );
  const stepX = Math.max(Math.round(minTile / 2), Math.round(tileWidth / 2));
  const stepY = Math.max(Math.round(minTile / 2), Math.round(tileHeight / 2));

  for (let tileY = 0; tileY < height && codes.length < maxCodes; tileY += stepY) {
    for (let tileX = 0; tileX < width && codes.length < maxCodes; tileX += stepX) {
      const regionWidth = Math.min(tileWidth, width - tileX);
      const regionHeight = Math.min(tileHeight, height - tileY);
      if (regionWidth < minTile || regionHeight < minTile) {
        continue;
      }
      const tileRgba = extractRgbaRegion(rgba, width, tileX, tileY, regionWidth, regionHeight);
      const decoded = decodeQrFromRgba(
        tileRgba,
        regionWidth,
        regionHeight,
        offsetX + tileX,
        offsetY + tileY
      );
      if (decoded !== null && isDuplicateQrCode(codes, decoded) === false) {
        codes.push(decoded);
      }
    }
  }
  return codes;
};

export const detectQrCodesInRgba = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    readonly offsetX?: number;
    readonly offsetY?: number;
    readonly maxCodes?: number;
  }
): readonly WorkbenchBrowserDetectedQrCode[] => {
  const maxCodes = Math.max(1, Math.min(12, Math.round(options?.maxCodes ?? 4)));
  const offsetX = options?.offsetX ?? 0;
  const offsetY = options?.offsetY ?? 0;
  const working = new Uint8ClampedArray(rgba);
  const codes: WorkbenchBrowserDetectedQrCode[] = [];
  while (codes.length < maxCodes) {
    const decoded = decodeQrFromRgba(working, width, height, offsetX, offsetY);
    if (decoded === null) {
      break;
    }
    codes.push(decoded);
    const local = jsQR(working, width, height, { inversionAttempts: "attemptBoth" });
    if (local === null) {
      break;
    }
    eraseQrRegion(working, width, height, local.location);
  }
  if (codes.length < maxCodes) {
    return scanQrCodesInTiles(rgba, width, height, offsetX, offsetY, maxCodes, codes);
  }
  return codes;
};

export const detectQrCodesInNativeImage = (
  image: NativeImage,
  options?: {
    readonly region?: WorkbenchBrowserAgentElementBounds;
    readonly maxCodes?: number;
  }
): readonly WorkbenchBrowserDetectedQrCode[] => {
  const maxCodes = Math.max(1, Math.min(12, Math.round(options?.maxCodes ?? 4)));
  const region = options?.region;
  const source = region === undefined
    ? image
    : image.crop({
        x: clampInt(region.x, 0, image.getSize().width - 1),
        y: clampInt(region.y, 0, image.getSize().height - 1),
        width: Math.max(1, Math.round(region.width)),
        height: Math.max(1, Math.round(region.height))
      });
  const offsetX = region?.x ?? 0;
  const offsetY = region?.y ?? 0;
  const { rgba, width, height } = readNativeImageRgba(source);
  return detectQrCodesInRgba(rgba, width, height, {
    offsetX,
    offsetY,
    maxCodes
  });
};

export const detectQrCodesInPngBase64 = (
  imageBase64: string,
  options?: {
    readonly region?: WorkbenchBrowserAgentElementBounds;
    readonly maxCodes?: number;
  }
): readonly WorkbenchBrowserDetectedQrCode[] => {
  const image = nativeImage.createFromBuffer(Buffer.from(imageBase64, "base64"));
  if (image.isEmpty()) {
    return [];
  }
  return detectQrCodesInNativeImage(image, options);
};

export const cropQrCodeFromPngBase64 = (
  imageBase64: string,
  bounds: WorkbenchBrowserAgentElementBounds,
  padding = 8
): {
  readonly imageBase64: string;
  readonly width: number;
  readonly height: number;
} => {
  const image = nativeImage.createFromBuffer(Buffer.from(imageBase64, "base64"));
  const size = image.getSize();
  const x = clampInt(bounds.x - padding, 0, size.width - 1);
  const y = clampInt(bounds.y - padding, 0, size.height - 1);
  const right = clampInt(bounds.x + bounds.width + padding, x + 1, size.width);
  const bottom = clampInt(bounds.y + bounds.height + padding, y + 1, size.height);
  const cropped = image.crop({
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  });
  const croppedSize = cropped.getSize();
  const png = cropped.toPNG();
  return {
    imageBase64: png.toString("base64"),
    width: croppedSize.width,
    height: croppedSize.height
  };
};