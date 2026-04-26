import { afterEach, describe, expect, test, vi } from "vitest";

import { createCaretMotionTrail, measureTextAreaCaretRect } from "../modern-caret";

const createRectList = (...rects: DOMRect[]): DOMRectList => {
  const list = {
    length: rects.length,
    item: (index: number) => rects[index] ?? null,
    [Symbol.iterator]: function* () {
      yield* rects;
    }
  } as DOMRectList & Iterable<DOMRect>;
  for (const [index, rect] of rects.entries()) {
    (list as Record<number, DOMRect>)[index] = rect;
  }
  return list;
};

describe("modern caret measurement", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  test("keeps the caret on the line end at a soft-wrap boundary in fallback measurement", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "abcdef";
    textarea.style.width = "31px";
    textarea.style.fontSize = "10px";
    textarea.style.lineHeight = "20px";
    textarea.style.padding = "0px";
    document.body.append(textarea);
    Object.defineProperty(textarea, "clientWidth", {
      configurable: true,
      value: 31
    });

    textarea.setSelectionRange(5, 5);
    const boundaryRect = measureTextAreaCaretRect(textarea);

    textarea.setSelectionRange(6, 6);
    const wrappedRect = measureTextAreaCaretRect(textarea);

    expect(boundaryRect?.left ?? 0).toBeCloseTo(31, 1);
    expect(boundaryRect?.top ?? 0).toBeCloseTo(1, 1);
    expect(wrappedRect?.left ?? 0).toBeCloseTo(6.2, 1);
    expect(wrappedRect?.top ?? 0).toBeCloseTo(21, 1);
  });

  test("uses the first client rect instead of the wrapped union box for mirrored carets", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "abcdefghij";
    textarea.style.width = "120px";
    textarea.style.fontSize = "12px";
    textarea.style.lineHeight = "20px";
    textarea.style.padding = "0px";
    document.body.append(textarea);
    Object.defineProperty(textarea, "clientWidth", {
      configurable: true,
      value: 120
    });
    textarea.setSelectionRange(4, 4);

    const originalBoundingRect = Element.prototype.getBoundingClientRect;
    const originalClientRects = Element.prototype.getClientRects;

    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element): DOMRect {
      if (this instanceof HTMLDivElement && this.style.visibility === "hidden") {
        return new DOMRect(10, 8, 120, 80);
      }
      if (this instanceof HTMLSpanElement) {
        return new DOMRect(12, 28, 100, 40);
      }
      return originalBoundingRect.call(this);
    });

    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element): DOMRectList {
      if (this instanceof HTMLSpanElement) {
        return createRectList(
          new DOMRect(72, 28, 8, 20),
          new DOMRect(12, 48, 44, 20)
        );
      }
      return originalClientRects.call(this);
    });

    const rect = measureTextAreaCaretRect(textarea);

    expect(rect?.left ?? 0).toBeCloseTo(62, 1);
    expect(rect?.top ?? 0).toBeCloseTo(21, 1);
  });

  test("extends the motion trail when the caret moves faster", () => {
    const previousRect = {
      left: 10,
      top: 12,
      height: 18
    };
    const nextRect = {
      left: 28,
      top: 12,
      height: 18
    };

    const slowTrail = createCaretMotionTrail(previousRect, nextRect, 120, 1);
    const fastTrail = createCaretMotionTrail(previousRect, nextRect, 16, 2);

    expect(slowTrail).not.toBeNull();
    expect(fastTrail).not.toBeNull();
    expect((fastTrail?.length ?? 0)).toBeGreaterThan(slowTrail?.length ?? 0);
  });
});
