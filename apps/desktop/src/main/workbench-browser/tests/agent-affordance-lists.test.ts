import { describe, expect, test } from "vitest";

import {
  affordanceStateWord,
  applyHoverMenus,
  collapseNestedAffordances,
  crossMapLines,
  formatAffordanceListsForMap,
  splitAffordanceColumns,
  surfaceMapElements,
  type AffordanceListFields
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
): AffordanceListFields => ({
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

  test("keeps a row menu button separate from the conversation", () => {
    const row = el(1, {
      tagName: "a",
      label: "最少证据与可验证约束",
      bounds: { x: 12, y: 80, width: 220, height: 36 },
      xpath: "/html/body/div/a",
      targetRef: "lumen:row"
    });
    const more = el(2, {
      tagName: "svg",
      label: "(no label)",
      bounds: { x: 190, y: 86, width: 16, height: 16 },
      xpath: "/html/body/div/a/svg",
      targetRef: "lumen:more"
    });
    const multi = el(3, {
      tagName: "button",
      label: "Multi-select",
      bounds: { x: 180, y: 40, width: 28, height: 28 },
      xpath: "/html/body/div/button",
      targetRef: "lumen:multi"
    });
    const kept = collapseNestedAffordances([row, more, multi]);
    expect(kept.map((item) => item.label)).toEqual(["最少证据与可验证约束", "(no label)", "Multi-select"]);
    expect(kept.every((item) => item.sameActionGroup === undefined)).toBe(true);
    const text = formatAffordanceListsForMap(kept, []);
    expect(text).not.toContain("same action, click any:");
  });

  test("keeps a trailing pointer div that sits inside the conversation link", () => {
    const row = el(1, {
      tagName: "a",
      label: "Sequence of numbers puzzle",
      bounds: { x: 12, y: 160, width: 236, height: 40 },
      xpath: "/html/body/div/a"
    });
    const more = el(2, {
      tagName: "div",
      label: "(no label)",
      bounds: { x: 208, y: 166, width: 28, height: 28 },
      xpath: "/html/body/div/a/div"
    });
    expect(collapseNestedAffordances([row, more]).map((item) => item.tagName)).toEqual(["a", "div"]);
  });

  test("keeps an icon button and its row as one action", () => {
    const row = el(1, {
      tagName: "div",
      label: "Account",
      bounds: { x: 12, y: 640, width: 216, height: 44 },
      xpath: "/html/body/div",
      targetRef: "lumen:b"
    });
    const avatar = el(2, {
      tagName: "img",
      label: "(no label)",
      bounds: { x: 24, y: 648, width: 28, height: 28 },
      xpath: "/html/body/div/img",
      targetRef: "lumen:a"
    });
    const more = el(3, {
      tagName: "button",
      label: "More",
      bounds: { x: 180, y: 650, width: 28, height: 28 },
      xpath: "/html/body/div/button",
      targetRef: "lumen:c"
    });
    const kept = collapseNestedAffordances([row, avatar, more]);
    expect(kept.map((item) => item.label)).toEqual(["Account", "(no label)", "More"]);
    expect(kept.find((item) => item.label === "More")?.sameActionGroup).toBeUndefined();
    expect(kept.find((item) => item.label === "Account")?.sameActionGroup).toBe(kept.find((item) => item.label === "(no label)")?.sameActionGroup);
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

  test("keeps a control the page already measured inside the window", () => {
    const account = el(1, {
      tagName: "div",
      label: "Account",
      bounds: { x: 12, y: 640, width: 216, height: 44 },
      offscreen: false,
      targetRef: "lumen:account"
    });
    const columns = splitAffordanceColumns([account], 800, 500);
    expect(columns.inViewport.map((item) => item.label)).toEqual(["Account"]);
  });
});

describe("formatAffordanceListsForMap", () => {
  test("prints two lists the model can act on", () => {
    const text = formatAffordanceListsForMap(
      [el(1, { tagName: "button", label: "Save", bounds: { x: 0, y: 0, width: 10, height: 10 }, targetRef: "lumen:save" })],
      [el(2, { tagName: "a", role: "link", label: "Footer", bounds: { x: 0, y: 900, width: 10, height: 10 }, targetRef: "lumen:footer" })]
    );

    expect(text).toContain("Now operable:");
    expect(text).toContain('[1 targetRef=lumen:save] button: "Save"');
    expect(text).toContain("Also on this page:");
    expect(text).toContain('[2 targetRef=lumen:footer] link: "Footer"');
  });

  test("keeps a blank-character name and marks the one at the bottom of the window", () => {
    const chat = el(1, {
      tagName: "div",
      label: "ㅤㅤㅤ",
      bounds: { x: 12, y: 200, width: 200, height: 32 },
      targetRef: "lumen:chat"
    });
    const account = el(2, {
      tagName: "div",
      label: "ㅤㅤㅤ",
      bounds: { x: 12, y: 680, width: 216, height: 44 },
      targetRef: "lumen:account"
    });
    const text = formatAffordanceListsForMap([chat, account], [], 0, 720);
    expect(text).toContain('[1 targetRef=lumen:chat] div: "unnamed div at this window (x=12, y=200)"');
    expect(text).toContain('[2 targetRef=lumen:account] div: "unnamed div at bottom of this window (x=12, y=680)"');
    expect(text).not.toContain('"ㅤㅤㅤ"');
  });

  test("tells a form of empty inputs to fill them in one call", () => {
    const text = formatAffordanceListsForMap(
      [
        el(1, { tagName: "input", label: "Phone number", bounds: { x: 0, y: 0, width: 200, height: 32 }, targetRef: "lumen:phone" }),
        el(2, { tagName: "input", label: "Password", bounds: { x: 0, y: 40, width: 200, height: 32 }, targetRef: "lumen:password" })
      ],
      []
    );
    expect(text).toContain("one browser_type call using fields");
  });

  test("marks an unlabeled icon at the end of a row", () => {
    const text = formatAffordanceListsForMap(
      [
        el(1, { tagName: "a", label: "Long conversation", xpath: "/html/body/a", bounds: { x: 12, y: 160, width: 236, height: 40 }, targetRef: "lumen:row" }),
        el(2, { tagName: "button", label: "(no label)", bounds: { x: 208, y: 166, width: 28, height: 28 }, xpath: "/html/body/a/button", targetRef: "lumen:more" })
      ],
      []
    );
    expect(text).toContain('icon at the end of "Long conversation"');
    expect(text).toContain('purpose=unknown');
    expect(text).not.toContain('(no label)');
  });

  test("never assigns overlapping portal icons to background rows", () => {
    const row = el(1, { tagName: "a", label: "Unrelated conversation", xpath: "/html/body/aside/a[6]", targetRef: "lumen:row", bounds: { x: 12, y: 348, width: 236, height: 40 } });
    const icon = el(2, { tagName: "div", label: "", xpath: "/html/body/div[2]/div[5]/div[1]", targetRef: "lumen:icon", bounds: { x: 225, y: 368, width: 14, height: 14 } });
    const text = formatAffordanceListsForMap([row, icon], []);
    expect(text).not.toContain('icon at the end of "Unrelated conversation"');
    expect(collapseNestedAffordances([row, icon])).toHaveLength(2);
  });

  test("uses stamped ancestry across XPath ID anchors and rejects unproven overlap", () => {
    const row = el(1, { tagName: "a", label: "Actual owner", xpath: '//*[@id="row"]', targetRef: "lumen:row", bounds: { x: 12, y: 160, width: 236, height: 40 } });
    const icon = { ...el(2, { tagName: "button", label: "", xpath: '//*[@id="icon"]', targetRef: "lumen:icon", bounds: { x: 208, y: 166, width: 28, height: 28 } }), ancestorTargetRefs: ["lumen:row"] };
    expect(formatAffordanceListsForMap([row, icon], [])).toContain('icon at the end of "Actual owner"');
    expect(formatAffordanceListsForMap([row, { ...icon, ancestorTargetRefs: [] }], [])).not.toContain('icon at the end of');
    const indexed = { ...icon, ancestorTargetRefs: [], xpath: '/html/body/div[2]' };
    expect(collapseNestedAffordances([{ ...row, xpath: '/html/body/div' }, indexed])).toHaveLength(2);
  });

  test("prints whether a switch is on or off", () => {
    const text = formatAffordanceListsForMap(
      [
        {
          ...el(1, { tagName: "div", label: "DeepThink", bounds: { x: 0, y: 0, width: 10, height: 10 }, targetRef: "lumen:think" }),
          stateHint: "pressed"
        },
        {
          ...el(2, { tagName: "div", label: "Search", bounds: { x: 20, y: 0, width: 10, height: 10 }, targetRef: "lumen:search" }),
          checked: false
        }
      ],
      []
    );
    expect(text).toContain('[1 targetRef=lumen:think] div: "DeepThink" on');
    expect(text).toContain('[2 targetRef=lumen:search] div: "Search" off');
    expect(affordanceStateWord({})).toBeNull();
  });

  test("writes current values without inventing the reason a button is disabled", () => {
    const text = formatAffordanceListsForMap(
      [
        {
          ...el(1, { tagName: "select", label: "Nationality", bounds: { x: 0, y: 0, width: 10, height: 10 }, targetRef: "lumen:nation" }),
          textSnippet: "Afghanistan",
          formGroup: "group:1"
        },
        {
          ...el(2, { tagName: "textarea", label: "Message", bounds: { x: 0, y: 40, width: 10, height: 10 }, targetRef: "lumen:msg" }),
          formGroup: "group:2"
        },
        {
          ...el(3, { tagName: "button", label: "Send", bounds: { x: 80, y: 40, width: 10, height: 10 }, targetRef: "lumen:send" }),
          disabled: true,
          formGroup: "group:2"
        }
      ],
      []
    );
    expect(text).toContain('[1 targetRef=lumen:nation] select: "Nationality" = Afghanistan');
    expect(text).toContain('[2 targetRef=lumen:msg] textarea: "Message" = ""');
    expect(text).toContain('[3 targetRef=lumen:send] button: "Send" disabled');
    expect(text).not.toContain('disabled until');
  });
});

describe("hover menus", () => {
  test("keeps a hover control beside its row and reuses the menu", () => {
    const row = el(1, {
      tagName: "div",
      label: "介绍与联网说明",
      bounds: { x: 12, y: 80, width: 220, height: 36 },
      xpath: "/html/body/div",
      targetRef: "lumen:row"
    });
    const more = {
      ...el(2, {
        tagName: "button",
        label: "(no label)",
        bounds: { x: 190, y: 86, width: 24, height: 24 },
        xpath: "/html/body/div/button",
        targetRef: "lumen:more"
      }),
      stateHint: "hover",
      selectorPreview: "button.more"
    };
    const later = {
      ...more,
      id: 3,
      label: "(no label)",
      bounds: { x: 190, y: 130, width: 24, height: 24 },
      targetRef: "lumen:more2"
    };
    expect(collapseNestedAffordances([row, more]).map((item) => item.targetRef)).toEqual(["lumen:row", "lumen:more"]);
    const noted = applyHoverMenus([more, later], [{ signature: "button.more", items: ["Rename", "Pin", "Delete"] }]);
    const text = formatAffordanceListsForMap(noted, []);
    expect(text).toContain("shows on hover");
    expect(text).toContain("click opens menu: Rename, Pin, Delete");
    expect(text).toContain("click opens the same menu as lumen:more");
  });

  test("writes the first repeated row in full and points the rest at it", () => {
    const row = (id: number, label: string, y: number, ref: string, moreRef: string) => [
      el(id, {
        tagName: "a",
        label,
        bounds: { x: 12, y, width: 220, height: 32 },
        targetRef: ref
      }),
      {
        ...el(id + 1, {
          tagName: "svg",
          label: "(no label)",
          bounds: { x: 200, y: y + 8, width: 16, height: 16 },
          targetRef: moreRef
        }),
        stateHint: "hover" as const,
        selectorPreview: "svg.more",
        ...(id === 1
          ? { menuItems: ["Rename", "Delete"] }
          : { menuSameAs: "lumen:more1" })
      }
    ];
    const lines = crossMapLines([
      ...row(1, "DeepSeek model version", 80, "lumen:row1", "lumen:more1"),
      ...row(3, "Ubuntu终端安装deb", 120, "lumen:row2", "lumen:more2")
    ], 0, "删除最新会话");
    expect(lines[0]).toContain("lumen:row1");
    expect(lines[1]).toContain("click opens menu: Rename, Delete");
    expect(lines.join("\n")).not.toContain("same row as");
    expect(lines.join("\n")).toContain("lumen:more2");
    expect(lines.join("\n")).not.toMatch(/Ubuntu[\s\S]*Rename/);
  });
});

describe("surfaceMapElements", () => {
  test("sends a short page in one payload", () => {
    const page = surfaceMapElements(["a"], ["b"]);
    expect(page.elements).toEqual(["a", "b"]);
    expect(page.remaining).toBe(0);
  });

  test("sends only the current window when many controls remain", () => {
    const outside = Array.from({ length: 30 }, (_, index) => `outside-${index}`);
    const page = surfaceMapElements(["visible"], outside);
    expect(page.elements).toEqual(["visible"]);
    expect(page.remaining).toBe(30);
  });
});
