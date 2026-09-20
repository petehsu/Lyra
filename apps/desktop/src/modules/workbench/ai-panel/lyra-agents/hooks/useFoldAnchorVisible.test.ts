import { afterEach, describe, expect, test } from "vitest";

import { isFoldAnchorVisuallyAvailable } from "./useFoldAnchorVisible";

const rect = (top: number, left: number, width: number, height: number): DOMRect =>
  ({
    x: left,
    y: top,
    width,
    height,
    top,
    left,
    right: left + width,
    bottom: top + height,
    toJSON() {
      return this;
    }
  }) as DOMRect;

const stubRect = (element: HTMLElement, value: DOMRect): void => {
  element.getBoundingClientRect = () => value;
};

const mountFold = (): { readonly scroller: HTMLElement; readonly anchor: HTMLElement } => {
  const scroller = document.createElement("div");
  scroller.className = "lyra-agents-chat-scroll";
  const button = document.createElement("button");
  const anchor = document.createElement("span");
  button.append(anchor);
  scroller.append(button);
  document.body.append(scroller);
  stubRect(scroller, rect(0, 0, 320, 400));
  return { scroller, anchor };
};

describe("isFoldAnchorVisuallyAvailable", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  test("keeps the fold toggle available while it intersects the chat scroller", () => {
    const { anchor } = mountFold();
    stubRect(anchor.closest("button") as HTMLElement, rect(40, 16, 120, 20));

    expect(isFoldAnchorVisuallyAvailable(anchor)).toBe(true);
  });

  test("hides the fold toggle once it has scrolled out of the chat scroller", () => {
    const { anchor } = mountFold();
    stubRect(anchor.closest("button") as HTMLElement, rect(-40, 16, 120, 20));

    expect(isFoldAnchorVisuallyAvailable(anchor)).toBe(false);
  });

  test("uses the wrapping fold button when the inner icon slot has no size", () => {
    const { anchor } = mountFold();
    stubRect(anchor, rect(40, 16, 0, 0));
    stubRect(anchor.closest("button") as HTMLElement, rect(40, 16, 120, 20));

    expect(isFoldAnchorVisuallyAvailable(anchor)).toBe(true);
  });
});
