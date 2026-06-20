import { describe, expect, test } from "vitest";

import { readPageDragContextFromTarget } from "../page-drag-context";

describe("page-drag-context", () => {
  test("reads selection and element metadata from a text node target", () => {
    document.body.innerHTML = `<article id="post"><p id="lead">Hello citation</p></article>`;
    const paragraph = document.getElementById("lead");
    if (paragraph === null) {
      throw new Error("paragraph fixture was not mounted");
    }

    const selection = window.getSelection();
    selection?.removeAllRanges();
    if (paragraph.firstChild !== null) {
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      selection?.addRange(range);
    }

    const context = readPageDragContextFromTarget(paragraph);
    expect(context.selectionText).toBe("Hello citation");
    expect(context.elementTag).toBe("p");
    expect(context.elementId).toBe("lead");
    expect(context.elementSelector).toBe("#lead");
  });

  test("reads image source metadata", () => {
    document.body.innerHTML = `<img id="avatar" src="https://example.com/a.png" alt="Avatar" />`;
    const image = document.getElementById("avatar");
    if (image === null) {
      throw new Error("image fixture was not mounted");
    }
    const context = readPageDragContextFromTarget(image);
    expect(context.mediaType).toBe("image");
    expect(context.srcUrl).toContain("https://example.com/a.png");
    expect(context.elementTag).toBe("img");
  });
});
