import { describe, expect, test } from "vitest";

import { defaultPreviewLayout, previewKindFromPath } from "../kinds";

describe("previewKindFromPath", () => {
  test("classifies markdown mermaid paper html svg and raster images", () => {
    expect(previewKindFromPath("/docs/README.md")).toBe("markdown");
    expect(previewKindFromPath("C:\\work\\flow.mmd")).toBe("mermaid");
    expect(previewKindFromPath("/papers/main.pdf")).toBe("paper");
    expect(previewKindFromPath("/site/index.html")).toBe("html");
    expect(previewKindFromPath("/assets/logo.svg")).toBe("svg");
    expect(previewKindFromPath("/photos/cat.png")).toBe("image");
    expect(previewKindFromPath("/src/main.ts")).toBeNull();
  });

  test("defaults papers images and svg to preview and other kinds to source", () => {
    expect(defaultPreviewLayout("paper")).toBe("preview");
    expect(defaultPreviewLayout("svg")).toBe("preview");
    expect(defaultPreviewLayout("image")).toBe("preview");
    expect(defaultPreviewLayout("markdown")).toBe("source");
    expect(defaultPreviewLayout(null)).toBe("source");
  });
});
