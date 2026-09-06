import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LyraMarkdown } from "../LyraMarkdown";
import { normalizeMermaidThemeColor } from "../streamdown-plugins";

describe("LyraMarkdown", () => {
  it("uses mature incomplete-markdown tolerance while streaming", () => {
    const view = render(<LyraMarkdown content="A **bold phrase" streaming />);

    expect(view.container.querySelector('[data-streamdown="strong"]')?.textContent)
      .toContain("bold phrase");
    view.rerender(<LyraMarkdown content="A [link](https://example" streaming />);
    expect(screen.getByText(/link/u)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("supports sanitized standard disclosure elements", () => {
    render(
      <LyraMarkdown
        content={'<details open><summary>More</summary>\n- Safe **content** with `code`\n</details>'}
      />
    );

    expect(screen.getByText("More").closest("summary")).not.toBeNull();
    expect(screen.getByRole("list")).toBeTruthy();
    expect(document.querySelector('[data-streamdown="strong"]')?.textContent).toBe("content");
    expect(screen.getByText("code").closest("code")).not.toBeNull();
    expect(screen.getByText("More").closest("details")).toHaveAttribute("open");
  });

  it("renders website links declaratively with the shared inline-resource visual", () => {
    render(
      <LyraMarkdown content="[OpenAI](https://openai.com/docs)" />
    );

    const link = screen.getByRole("link", { name: "OpenAI" });
    expect(link).toHaveClass("lyra-agents-md-link");
    expect(link).toHaveClass("lyra-agents-md-url-link");
    expect(link).toHaveClass("lyra-agents-inline-resource");
    expect(link).toHaveAttribute("href", "https://openai.com/docs");
    expect(link.querySelector(".lyra-agents-citation-chip-icon")).not.toBeNull();
    expect(link.querySelector(".lyra-agents-citation-chip-preview")?.textContent).toBe("OpenAI");
  });

  it("keeps CSS Color 4 values out of Mermaid's restricted color parser", () => {
    expect(normalizeMermaidThemeColor(
      "color-mix(in srgb, #4e3e34 16%, transparent)",
      "#e4e3e4"
    )).toBe("#e4e3e4");
    expect(normalizeMermaidThemeColor("#4e3e34", "#e4e3e4")).toBe("#4e3e34");
    expect(normalizeMermaidThemeColor("rgb(78, 62, 52)", "#e4e3e4"))
      .toBe("rgb(78, 62, 52)");
  });

  it("sanitizes executable HTML", () => {
    const { container } = render(
      <LyraMarkdown content={'<img src="x" onerror="alert(1)"><script>alert(1)</script>'} />
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
  });
});
