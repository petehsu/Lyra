import { describe, expect, test } from "vitest";

import {
  imageAttachmentPreview,
  normalizeInlineImageAttachment,
  parseInlineImagesFromMetadata
} from "../composer-image";

describe("composer-image", () => {
  test("parses path-only inline image metadata", () => {
    const image = normalizeInlineImageAttachment({
      id: "img-1",
      mediaType: "image/png",
      source: "/Users/test/Downloads/shot.png",
      label: "shot.png"
    });
    expect(image).toEqual({
      id: "img-1",
      mediaType: "image/png",
      data: "",
      source: "/Users/test/Downloads/shot.png",
      label: "shot.png",
      width: null,
      height: null,
      workspaceTabId: null,
      workspaceTabTitle: null,
      workspaceTabPageKind: null,
      workspaceTabAddress: null
    });
  });

  test("preview falls back to source filename when label is missing", () => {
    expect(imageAttachmentPreview({
      id: "img-1",
      mediaType: "image/png",
      source: "/Users/test/Downloads/shot.png"
    })).toBe("shot.png");
  });

  test("parseInlineImagesFromMetadata keeps path-only entries", () => {
    const images = parseInlineImagesFromMetadata({
      inlineImages: [{
        id: "img-1",
        mediaType: "image/jpeg",
        source: "/tmp/photo.jpg"
      }]
    });
    expect(images).toHaveLength(1);
    expect(images[0]?.source).toBe("/tmp/photo.jpg");
    expect(images[0]?.data).toBe("");
  });
});