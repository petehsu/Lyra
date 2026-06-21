import { PNG } from "pngjs";
import QRCode from "qrcode";
import { describe, expect, test } from "vitest";

import {
  detectQrCodesInRgba
} from "../view-manager-runtime/qr-detection-runtime";

const createQrRgba = async (
  payload: string,
  size = 180
): Promise<{ readonly rgba: Uint8ClampedArray; readonly width: number; readonly height: number }> => {
  const pngBuffer = await QRCode.toBuffer(payload, {
    type: "png",
    margin: 2,
    width: size,
    errorCorrectionLevel: "M"
  });
  const png = PNG.sync.read(pngBuffer);
  return {
    rgba: new Uint8ClampedArray(png.data),
    width: png.width,
    height: png.height
  };
};

describe("qr-detection-runtime", () => {
  test("detects a QR code and returns bounds", async () => {
    const payload = "https://login.example.com/qr/session-123";
    const { rgba, width, height } = await createQrRgba(payload);
    const codes = detectQrCodesInRgba(rgba, width, height);
    expect(codes.length).toBeGreaterThanOrEqual(1);
    expect(codes[0]?.payload).toBe(payload);
    expect(codes[0]?.bounds.width).toBeGreaterThan(40);
    expect(codes[0]?.bounds.height).toBeGreaterThan(40);
    expect(codes[0]?.center.x).toBeGreaterThan(0);
    expect(codes[0]?.center.y).toBeGreaterThan(0);
  });

  test("detects multiple QR codes when present", async () => {
    const left = await createQrRgba("https://left.example/a", 120);
    const right = await createQrRgba("https://right.example/b", 120);
    const width = left.width + right.width + 40;
    const height = Math.max(left.height, right.height);
    const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
    const blit = (
      source: Uint8ClampedArray,
      sourceWidth: number,
      sourceHeight: number,
      destX: number,
      destY: number
    ): void => {
      for (let y = 0; y < sourceHeight; y += 1) {
        for (let x = 0; x < sourceWidth; x += 1) {
          const sourceIndex = (y * sourceWidth + x) * 4;
          const targetIndex = ((destY + y) * width + (destX + x)) * 4;
          rgba[targetIndex] = source[sourceIndex] ?? 255;
          rgba[targetIndex + 1] = source[sourceIndex + 1] ?? 255;
          rgba[targetIndex + 2] = source[sourceIndex + 2] ?? 255;
          rgba[targetIndex + 3] = 255;
        }
      }
    };
    blit(left.rgba, left.width, left.height, 10, 10);
    blit(right.rgba, right.width, right.height, left.width + 30, 10);
    const codes = detectQrCodesInRgba(rgba, width, height, { maxCodes: 4 });
    expect(codes.map((code) => code.payload).sort()).toEqual([
      "https://left.example/a",
      "https://right.example/b"
    ]);
  });
});