import { createAiTextLayoutService } from "../service";

describe("ai text layout service", () => {
  test("reuses prepared cache entries for same key", () => {
    const service = createAiTextLayoutService();
    const first = service.prepare("hello lyra", "400 12px system-ui", {
      whiteSpace: "normal"
    });
    const second = service.prepare("hello lyra", "400 12px system-ui", {
      whiteSpace: "normal"
    });

    expect(second).toBe(first);

    service.clearCache();

    const third = service.prepare("hello lyra", "400 12px system-ui", {
      whiteSpace: "normal"
    });
    expect(third).not.toBe(first);
  });

  test("computes stable line counts for narrow vs wide widths", () => {
    const service = createAiTextLayoutService();
    const text = "Lyra text layout should wrap differently when width changes.";

    const wide = service.measureParagraph({
      text,
      font: "400 12px system-ui",
      lineHeightPx: 18,
      maxWidthPx: 320,
      whiteSpace: "normal"
    });

    const narrow = service.measureParagraph({
      text,
      font: "400 12px system-ui",
      lineHeightPx: 18,
      maxWidthPx: 120,
      whiteSpace: "normal"
    });

    expect(narrow.lineCount).toBeGreaterThanOrEqual(wide.lineCount);
    expect(narrow.heightPx).toBeGreaterThanOrEqual(wide.heightPx);
  });

  test("flags overflow when max lines are exceeded", () => {
    const service = createAiTextLayoutService();

    const isOverflowing = service.isOverflowing({
      text: "Long content for overflow detection in runtime and sidebar components.",
      font: "400 11px system-ui",
      lineHeightPx: 16,
      maxWidthPx: 96,
      maxLines: 1,
      whiteSpace: "normal"
    });

    expect(isOverflowing).toBe(true);
  });

  test("layoutWithLines respects maxLines projection", () => {
    const service = createAiTextLayoutService();
    const prepared = service.prepare(
      "line one line two line three line four",
      "400 12px system-ui",
      { whiteSpace: "normal" }
    );

    const result = service.layoutWithLines(prepared, 90, 18, 2);

    expect(result.lineCount).toBeGreaterThanOrEqual(2);
    expect(result.lines.length).toBe(2);
    expect(result.isOverflowing).toBe(true);
  });
});
