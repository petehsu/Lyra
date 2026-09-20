import { describe, expect, it } from "vitest";

import {
  isSafeCssColor,
  remarkDefinitionLists,
  sanitizeInlineStyle
} from "../rich-markdown-plugins";

describe("sanitizeInlineStyle", () => {
  it("keeps hex and named colors", () => {
    expect(isSafeCssColor("#dc2626")).toBe(true);
    expect(isSafeCssColor("Blue")).toBe(true);
    expect(sanitizeInlineStyle("color: #dc2626; background-color: yellow")).toBe(
      "color: #dc2626; background-color: yellow"
    );
  });

  it("drops url, expression, and non-color properties", () => {
    expect(sanitizeInlineStyle("background: url(javascript:alert(1))")).toBeUndefined();
    expect(sanitizeInlineStyle("color: expression(alert(1))")).toBeUndefined();
    expect(sanitizeInlineStyle("position: fixed; color: red")).toBe("color: red");
  });
});

describe("remarkDefinitionLists", () => {
  it("turns extra and cjk glossary paragraphs into dl", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "Markdown\n: 一种轻量级标记语言" }]
        },
        {
          type: "paragraph",
          children: [{ type: "text", value: "HTML：超文本标记语言\nCSS：层叠样式表" }]
        }
      ]
    };
    remarkDefinitionLists()(tree);
    expect(tree.children[0]?.data).toEqual({ hName: "dl" });
    expect(tree.children[1]?.data).toEqual({ hName: "dl" });
    expect(tree.children[0]?.children?.[0]?.data).toEqual({ hName: "dt" });
    expect(tree.children[1]?.children?.[0]?.data).toEqual({ hName: "dt" });
    expect(tree.children[1]?.children?.[1]?.data).toEqual({ hName: "dd" });
  });
});
