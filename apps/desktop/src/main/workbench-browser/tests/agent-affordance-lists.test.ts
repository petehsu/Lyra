import { describe, expect, test } from "vitest";

import {
  collapseNestedAffordances,
  formatAffordanceListsForMap,
  splitAffordanceColumns
} from "../view-manager-runtime/agent-affordance-lists";

const el = (
  id: number,
  rest: {
    tagName: string;
    role?: string;
    label: string;
    bounds: { x: number; y: number; width: number; height: number };
    href?: string;
    xpath?: string;
    editable?: boolean;
    offscreen?: boolean;
    targetRef?: string;
  }
) => ({
  id,
  frameRef: "main",
  tagName: rest.tagName,
  role: rest.role ?? rest.tagName,
  label: rest.label,
  bounds: rest.bounds,
  ...(rest.href === undefined ? {} : { href: rest.href }),
  ...(rest.xpath === undefined ? {} : { xpath: rest.xpath }),
  ...(rest.editable === undefined ? {} : { editable: rest.editable }),
  ...(rest.offscreen === undefined ? {} : { visibility: { visible: !rest.offscreen, offscreen: rest.offscreen, covered: false, ariaHidden: false } }),
  ...(rest.targetRef === undefined ? {} : { targetRef: rest.targetRef })
});

describe("collapseNestedAffordances", () => {
  test("keeps the button and drops inner text/shape nodes", () => {
    const button = el(1, {
      tagName: "button",
      label: "Buy",
      bounds: { x: 10, y: 10, width: 120, height: 40 },
      xpath: "/html/body/button"
    });
    const text = el(2, {
      tagName: "span",
      role: "button",
      label: "Buy",
      bounds: { x: 20, y: 18, width: 80, height: 20 },
      xpath: "/html/body/button/span"
    });
    const shadow = el(3, {
      tagName: "span",
      role: "presentation",
      label: "Buy",
      bounds: { x: 12, y: 12, width: 116, height: 36 },
      xpath: "/html/body/button/span[1]"
    });

    expect(collapseNestedAffordances([button, text, shadow]).map((item) => item.id)).toEqual([1]);
  });

  test("drops an outer pointer card when the inner control is the button", () => {
    const card = el(1, {
      tagName: "div",
      role: "generic",
      label: "Buy now",
      bounds: { x: 0, y: 0, width: 280, height: 120 },
      xpath: "/html/body/div"
    });
    const button = el(2, {
      tagName: "button",
      label: "Buy now",
      bounds: { x: 20, y: 70, width: 100, height: 32 },
      xpath: "/html/body/div/button"
    });

    expect(collapseNestedAffordances([card, button]).map((item) => item.id)).toEqual([2]);
  });

  test("keeps two buttons inside a card and drops the card", () => {
    const card = el(1, {
      tagName: "div",
      label: "Product",
      bounds: { x: 0, y: 0, width: 300, height: 200 },
      xpath: "/html/body/div"
    });
    const buy = el(2, {
      tagName: "button",
      label: "Buy",
      bounds: { x: 16, y: 150, width: 80, height: 32 },
      xpath: "/html/body/div/button[1]"
    });
    const wish = el(3, {
      tagName: "button",
      label: "Wishlist",
      bounds: { x: 110, y: 150, width: 80, height: 32 },
      xpath: "/html/body/div/button[2]"
    });

    expect(collapseNestedAffordances([card, buy, wish]).map((item) => item.id)).toEqual([2, 3]);
  });

  test("keeps a nested link with its own href", () => {
    const button = el(1, {
      tagName: "button",
      label: "Share",
      bounds: { x: 0, y: 0, width: 200, height: 80 },
      xpath: "/html/body/button"
    });
    const link = el(2, {
      tagName: "a",
      role: "link",
      label: "Docs",
      href: "https://example.test/docs",
      bounds: { x: 8, y: 48, width: 40, height: 20 },
      xpath: "/html/body/button/a"
    });

    expect(collapseNestedAffordances([button, link]).map((item) => item.id)).toEqual([1, 2]);
  });

  test("drops a wrapping label around an input", () => {
    const label = el(1, {
      tagName: "label",
      label: "Email",
      bounds: { x: 0, y: 0, width: 240, height: 48 },
      xpath: "/html/body/label"
    });
    const input = el(2, {
      tagName: "input",
      role: "textbox",
      label: "Email",
      bounds: { x: 8, y: 20, width: 220, height: 24 },
      xpath: "/html/body/label/input"
    });

    expect(collapseNestedAffordances([label, input]).map((item) => item.id)).toEqual([2]);
  });
});

describe("splitAffordanceColumns", () => {
  test("splits current window vs needs-scroll", () => {
    const visible = el(1, {
      tagName: "button",
      label: "Save",
      bounds: { x: 10, y: 10, width: 80, height: 24 },
      targetRef: "lumen:save"
    });
    const below = el(2, {
      tagName: "button",
      label: "Footer",
      bounds: { x: 10, y: 900, width: 80, height: 24 },
      offscreen: true,
      targetRef: "lumen:footer"
    });

    const columns = splitAffordanceColumns([visible, below], 1280, 720);
    expect(columns.inViewport.map((item) => item.label)).toEqual(["Save"]);
    expect(columns.needsScroll.map((item) => item.label)).toEqual(["Footer"]);
  });
});

describe("formatAffordanceListsForMap", () => {
  test("prints two lists the model can act on", () => {
    const text = formatAffordanceListsForMap(
      [el(1, { tagName: "button", label: "Save", bounds: { x: 0, y: 0, width: 10, height: 10 }, targetRef: "lumen:save" })],
      [el(2, { tagName: "a", role: "link", label: "Footer", bounds: { x: 0, y: 900, width: 10, height: 10 }, targetRef: "lumen:footer" })]
    );

    expect(text).toContain("Now clickable:");
    expect(text).toContain('[1 targetRef=lumen:save] button: "Save"');
    expect(text).toContain("Needs scroll (act on these; do not call scroll, find, or ensure_visible):");
    expect(text).toContain('[2 targetRef=lumen:footer] link: "Footer"');
  });
});
