import { describe, expect, test } from "vitest";

import {
  isImageViewerSupportedPath,
  titleFromImagePath
} from "../path-utils";

describe("image viewer path utils", () => {
  test("identifies supported image extensions", () => {
    expect(isImageViewerSupportedPath("/tmp/photo.PNG")).toBe(true);
    expect(isImageViewerSupportedPath("C:\\images\\scan.tiff")).toBe(true);
    expect(isImageViewerSupportedPath("/tmp/capture.heic")).toBe(true);
    expect(isImageViewerSupportedPath("/tmp/source.ts")).toBe(false);
  });

  test("derives a display title from the file path", () => {
    expect(titleFromImagePath("/tmp/folder/frame.webp")).toBe("frame.webp");
    expect(titleFromImagePath("C:\\images\\hero.avif")).toBe("hero.avif");
  });
});
