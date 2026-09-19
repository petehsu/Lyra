import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SessionMeta } from "../../../core/types";
import { createDataProviderValue } from "../../../data/createDataProviderValue";
import { DataContextProvider } from "../../../data/DataProvider";
import { LyraMarkdown } from "../LyraMarkdown";
import { normalizeMermaidThemeColor } from "../streamdown-plugins";

describe("LyraMarkdown", () => {
  it("renders settled heading and live tail through the same streamdown pipeline", () => {
    const view = render(<LyraMarkdown content={"# Title\n\nBody still writing"} streaming />);
    expect(screen.getByRole("heading", { name: "Title" })).toBeTruthy();
    expect(view.container.textContent).toContain("Body still writing");
    expect(view.container.querySelector(".lyra-agents-streamdown-chunks")).not.toBeNull();
    view.rerender(<LyraMarkdown content={"# Title\n\nBody still writing"} />);
    expect(screen.getByRole("heading", { name: "Title" })).toBeTruthy();
    expect(view.container.textContent).toContain("Body still writing");
  });

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

  it("lays out a short caption plus a standalone image as side-flow", () => {
    const { container } = render(
      <LyraMarkdown content={"200×200 的方图。\n\n![square](https://example.com/square.png)"} />
    );

    expect(container.querySelector(".lyra-agents-figure-row.is-single")).not.toBeNull();
    expect(container.querySelector(".lyra-agents-side-flow")).not.toBeNull();
    expect(container.querySelector(".lyra-agents-adaptive-image")).not.toBeNull();
    expect(container.querySelector(".lyra-agents-adaptive-image-fill")).toBeNull();
    expect(container.querySelector(".lyra-ui-button-size-sm")).toBeNull();
  });

  it("does not let a numbered caption list collapse into one image strip", () => {
    const { container } = render(
      <LyraMarkdown
        content={[
          "好的，给你放几张图：",
          "",
          "1. 200x200 小方形",
          "![a](https://example.com/a.png)",
          "2. 400x300 小横图",
          "![b](https://example.com/b.png)"
        ].join("\n")}
      />
    );

    expect(container.querySelector(".lyra-agents-media-cards")).toBeNull();
    expect(container.querySelector(".lyra-agents-figure-row.is-multi")).not.toBeNull();
    expect(container.querySelectorAll(".lyra-agents-figure-row .lyra-agents-side-flow")).toHaveLength(2);
    expect(container.querySelector(".lyra-agents-adaptive-image-fill")).toBeNull();
    expect(container.querySelectorAll(".lyra-agents-side-flow")).toHaveLength(2);
    expect(container.textContent).toContain("好的，给你放几张图：");
    expect(container.textContent).toContain("200x200");
    expect(container.textContent).toContain("400x300");
  });

  it("puts image facts beside the photo instead of stacking a metadata wall", () => {
    const { container } = render(
      <LyraMarkdown
        content={[
          "你链接的这张是 Pexels 上的一张黑白街拍：法国南希雨天的街景。",
          "",
          "具体信息：",
          "- 作者：Alexis B",
          "- 地点：Nancy, Grand Est, France",
          "- 尺寸：2072x2072，正方形",
          "- 链接：https://www.pexels.com/photo/example/",
          "",
          "![street](https://example.com/nancy.png)",
          "",
          "和你现在打开的那张是同一个作者。"
        ].join("\n")}
      />
    );

    expect(container.querySelector(".lyra-agents-figure-row.is-single")).not.toBeNull();
    expect(container.querySelector(".lyra-agents-side-flow-image-text")).not.toBeNull();
    expect(container.querySelector(".lyra-agents-side-flow.is-column-pair")).not.toBeNull();
    expect(container.textContent).toContain("你链接的这张是 Pexels 上的一张黑白街拍");
    expect(container.textContent).toContain("作者：Alexis B");
    expect(container.textContent).toContain("和你现在打开的那张是同一个作者。");
  });

  it("renders a workspace-relative markdown image through the session preview protocol", () => {
    const session: SessionMeta = {
      title: "Test",
      project: "Lyra",
      workingDir: "/home/xu-yuanhao/Documents/test",
      projectBound: true,
      workingDirIsHome: false,
      totalAdditions: 0,
      totalDeletions: 0
    };
    const data = createDataProviderValue({ session, messages: [] });
    const { container } = render(
      <DataContextProvider value={data}>
        <LyraMarkdown content={"What's in it:\n\n![Pelican riding a bicycle](pelican-bicycle.svg)"} />
      </DataContextProvider>
    );

    const img = container.querySelector("img.lyra-agents-adaptive-image-photo");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(
      `lyra-file://preview?path=${encodeURIComponent("/home/xu-yuanhao/Documents/test/pelican-bicycle.svg")}&contentType=${encodeURIComponent("image/svg+xml")}`
    );
  });

  it("renders dollar math through KaTeX", () => {
    const { container } = render(<LyraMarkdown content={"The square is $x^2$."} />);
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector(".katex")?.textContent).toContain("x");
  });

  it("renders AI TeX delimiters through KaTeX", () => {
    const { container } = render(
      <LyraMarkdown content={"Display:\n\n\\[e = mc^2\\]\n\nInline \\(a_i\\)."} />
    );
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
  });
});
