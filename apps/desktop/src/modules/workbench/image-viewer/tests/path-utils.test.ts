import { describe, expect, test } from "vitest";

import {
  isBrowserImageSourcePath,
  isImageViewerSupportedPath,
  isRasterImageViewerPath,
  titleFromImagePath
} from "../path-utils";

describe("image viewer path utils", () => {
  test("identifies supported image extensions", () => {
    expect(isImageViewerSupportedPath("/tmp/photo.PNG")).toBe(true);
    expect(isImageViewerSupportedPath("C:\\images\\scan.tiff")).toBe(true);
    expect(isImageViewerSupportedPath("/tmp/capture.heic")).toBe(true);
    expect(isImageViewerSupportedPath("/tmp/source.ts")).toBe(false);
    expect(isRasterImageViewerPath("/tmp/photo.png")).toBe(true);
    expect(isRasterImageViewerPath("/tmp/logo.svg")).toBe(false);
    expect(isRasterImageViewerPath("/tmp/source.ts")).toBe(false);
    expect(isBrowserImageSourcePath("/tmp/logo.svg")).toBe(true);
    expect(isBrowserImageSourcePath("/tmp/photo.png")).toBe(true);
    expect(isBrowserImageSourcePath("/tmp/scan.tiff")).toBe(false);
  });

  test("derives a display title from the file path", () => {
    expect(titleFromImagePath("/tmp/folder/frame.webp")).toBe("frame.webp");
    expect(titleFromImagePath("C:\\images\\hero.avif")).toBe("hero.avif");
  });
});
