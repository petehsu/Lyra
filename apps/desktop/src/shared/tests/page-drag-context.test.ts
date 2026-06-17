import { describe, expect, test } from "vitest";

import { readPageDragContextFromTarget } from "../page-drag-context";

describe("page-drag-context", () => {
  test("reads selection and element metadata from a text node target", () => {
    document.body.innerHTML = `<article id="post"><p id="lead">Hello citation</p></article>`;
    const paragraph = document.getElementById("lead");
    expect(paragraph).not.toBeNull();

    const selection = window.getSelection();
    selection?.removeAllRanges();
    if (paragraph?.firstChild !== null && paragraph.firstChild !== undefined) {
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
    const context = readPageDragContextFromTarget(image);
    expect(context.mediaType).toBe("image");
    expect(context.srcUrl).toContain("https://example.com/a.png");
    expect(context.elementTag).toBe("img");
  });
});