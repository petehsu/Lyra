import { describe, expect, it } from "vitest";

import { normalizeAiLatex } from "../normalize-ai-latex";

describe("normalizeAiLatex", () => {
  it("maps TeX delimiters onto remark-math dollars", () => {
    expect(normalizeAiLatex("Inline \\(x^2\\) and display \\[e=mc^2\\].")).toBe(
      "Inline $x^2$ and display $$\ne=mc^2\n$$."
    );
  });

  it("keeps fenced and inline code untouched", () => {
    const source = [
      "See `\\[not math\\]` and:",
      "```ts",
      "const x = `\\(a\\)`;",
      "```",
      "",
      "Done \\(a+b\\)."
    ].join("\n");
    expect(normalizeAiLatex(source)).toBe(
      [
        "See `\\[not math\\]` and:",
        "```ts",
        "const x = `\\(a\\)`;",
        "```",
        "",
        "Done $a+b$."
      ].join("\n")
    );
  });

  it("turns math fences into display math", () => {
    expect(normalizeAiLatex("```math\nE = mc^2\n```")).toBe("$$\nE = mc^2\n$$");
  });

  it("wraps a bare KaTeX environment", () => {
    expect(normalizeAiLatex("\\begin{align}\na &= b\n\\end{align}")).toBe(
      "$$\n\\begin{align}\na &= b\n\\end{align}\n$$"
    );
  });

  it("does not wrap an environment already in display math", () => {
    const source = "$$\\begin{align}a&=b\\end{align}$$";
    expect(normalizeAiLatex(source)).toBe(source);
  });

  it("does not wrap an environment already inside a $$ block", () => {
    const source = [
      "$$",
      "A = \\begin{bmatrix}",
      "1 & 2 \\\\",
      "3 & 4",
      "\\end{bmatrix}",
      "$$"
    ].join("\n");
    expect(normalizeAiLatex(source)).toBe(source);
  });

  it("does not treat escaped markdown brackets as TeX delimiters", () => {
    expect(normalizeAiLatex("显示原始符号：\\[不是链接\\]")).toBe(
      "显示原始符号：\\[不是链接\\]"
    );
  });
});
