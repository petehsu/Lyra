import { describe, expect, it } from "vitest";

import { renderMarkdown } from "../src/index";

describe("renderMarkdown", () => {
  it("renders common markdown through sanitized html", () => {
    const result = renderMarkdown("- [x] done\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n~~old~~", {
      mode: "final"
    });

    expect(result.html).toContain("<table");
    expect(result.html).toContain("task-list-item-checkbox");
    expect(result.html).toContain("<s>old</s>");
  });

  it("blocks unsafe html and urls", () => {
    const result = renderMarkdown("<script>alert(1)</script>\n\n[x](javascript:alert(1))", {
      mode: "final"
    });

    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain('href="javascript:');
  });

  it("blocks remote images while keeping local image sources", () => {
    const result = renderMarkdown(
      [
        "![remote](https://example.test/leak.png)",
        "![local](lyra-file://preview?path=%2Ftmp%2Fshot.png)",
        '<img src="https://example.test/raw.png" srcset="https://example.test/2x.png 2x">'
      ].join("\n"),
      { mode: "final" }
    );

    expect(result.html).not.toContain("https://example.test");
    expect(result.html).toContain("remote");
    expect(result.html).toContain("lyra-file://preview");
    expect(result.html).not.toContain("srcset=");
  });

  it("keeps math plain while streaming and renders katex after final", () => {
    const streaming = renderMarkdown("Inline $x^2$.\n\n$$x^2$$", { mode: "streaming" });
    const final = renderMarkdown("Inline $x^2$.\n\n$$x^2$$", { mode: "final" });

    expect(streaming.html).not.toContain("katex");
    expect(final.html).toContain("katex");
  });

  it("emits mermaid jobs only in final mode", () => {
    const source = "```mermaid\nflowchart LR\n  A-->B\n```";
    const streaming = renderMarkdown(source, { mode: "streaming" });
    const final = renderMarkdown(source, { mode: "final" });

    expect(streaming.mermaidJobs).toHaveLength(0);
    expect(final.mermaidJobs).toHaveLength(1);
    expect(final.html).toContain("lyra-markdown-mermaid");
  });
});
