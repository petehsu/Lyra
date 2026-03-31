import { describe, expect, test } from "vitest";

import {
  clip,
  containsBotChallenge,
  decodeHtmlEntities,
  decodeJsLiteral,
  extractTagContent,
  resolveDuckDuckGoRedirect,
  stableResultId,
  stripHtmlTags,
  toDisplayUrl,
  toResultMergeKey
} from "../parse";

describe("search parse utils", () => {
  test("decodes common html entities and numeric entities", () => {
    expect(decodeHtmlEntities("A&amp;B &lt;C&gt; &#33; &#x41;"))
      .toBe("A&B <C> ! A");
  });

  test("strips tags/scripts/styles and compacts whitespace", () => {
    expect(
      stripHtmlTags("<div>Hello <script>bad()</script><style>.x{}</style><b>World</b></div>")
    ).toBe("Hello World");
  });

  test("decodes js escapes and unicode", () => {
    expect(decodeJsLiteral("hello\\n\\u4e2d\\u6587\\x21")).toBe("hello 中文!");
  });

  test("resolves duckduckgo redirect uddg url", () => {
    const redirected = resolveDuckDuckGoRedirect(
      "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs"
    );
    expect(redirected).toBe("https://example.com/docs");
  });

  test("builds display url and merge key", () => {
    expect(toDisplayUrl("https://www.example.com/a/b?q=1")).toBe("www.example.com/a/b?q=1");
    expect(toResultMergeKey("https://www.example.com/a/"))
      .toBe("example.com/a");
  });

  test("clip and challenge detection", () => {
    expect(clip("abcdef", 4)).toBe("abc…");
    expect(containsBotChallenge("please solve CAPTCHA challenge")).toBe(true);
    expect(containsBotChallenge("normal html")).toBe(false);
  });

  test("extracts tag content and creates stable result id", () => {
    expect(extractTagContent("<item><title>  Hi&nbsp;Lyra </title></item>", "title"))
      .toBe("Hi Lyra");
    expect(stableResultId("bing", 2, "https://www.example.com/a/"))
      .toBe("bing-2-example.com/a");
  });
});
