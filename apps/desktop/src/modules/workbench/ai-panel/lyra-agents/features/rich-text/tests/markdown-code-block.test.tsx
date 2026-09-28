import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeClipboardText } from "../../../../../../../shared/clipboard";
import { t } from "@workbench/i18n";
import { LyraMarkdown } from "../LyraMarkdown";

vi.mock("../../../../../../../shared/clipboard", () => ({ writeClipboardText: vi.fn() }));

describe("Markdown code block controls", () => {
  beforeEach(() => vi.mocked(writeClipboardText).mockReset().mockResolvedValue(true));
  afterEach(() => vi.unstubAllGlobals());

  it("shows a language header and copies exact source while wrapping only the display", async () => {
    const code = 'printf "你好\\n"\n  echo "https://example.com/a?b=c"\n\n';
    const { container } = render(<LyraMarkdown content={`\`\`\`bash\n${code}\`\`\``} />);
    const block = container.querySelector(".lyra-markdown-code-block")!;
    expect(block.querySelector(".lyra-markdown-code-language")?.textContent).toBe("bash");
    expect(block.querySelector(".lyra-markdown-code-language svg")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("richText.codeBlock.wrap") }));
    expect(block).toHaveAttribute("data-wrap", "true");
    expect(screen.getByRole("button", { name: t("richText.codeBlock.wrap") })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: t("richText.codeBlock.copy") }));
    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith(code));
    await screen.findByRole("button", { name: t("dialog.copiedAction") });
    expect(within(block as HTMLElement).getByRole("status")).toHaveTextContent(t("dialog.copiedAction"));
    expect(block.querySelector("a")).toBeNull();
  });

  it("labels an untyped path fence as text without inventing a programming language", () => {
    const { container } = render(<LyraMarkdown content={'```\n/home/me/项目/reference\n```\n\nInline `echo hi`'} />);
    expect(container.querySelector(".lyra-markdown-code-language")?.textContent).toBe(t("richText.codeBlock.text"));
    expect(container.querySelectorAll(".lyra-markdown-code-block")).toHaveLength(1);
    expect(screen.getByText("echo hi").closest(".lyra-markdown-code-block")).toBeNull();
  });

  it("copies the latest streamed content and drops stale success feedback", async () => {
    const view = render(<LyraMarkdown content={'```js\nconst value = 1;'} streaming />);
    fireEvent.click(screen.getByRole("button", { name: t("richText.codeBlock.copy") }));
    await screen.findByRole("button", { name: t("dialog.copiedAction") });
    view.rerender(<LyraMarkdown content={'```js\nconst value = 12;\nconsole.log(value);'} streaming />);
    fireEvent.click(screen.getByRole("button", { name: t("richText.codeBlock.copy") }));
    await waitFor(() => expect(writeClipboardText).toHaveBeenLastCalledWith('const value = 12;\nconsole.log(value);\n'));
    view.rerender(<LyraMarkdown content={'```js\nconst value = 12;\nconsole.log(value);\n```'} />);
    expect(view.container.querySelectorAll(".lyra-markdown-code-block")).toHaveLength(1);
    expect(view.container.textContent).toContain("console.log(value)");
  });

  it("reports failed copy and allows retry instead of claiming success", async () => {
    vi.mocked(writeClipboardText).mockResolvedValueOnce(false);
    render(<LyraMarkdown content={'```\ncopy me\n```'} />);
    fireEvent.click(screen.getByRole("button", { name: t("richText.codeBlock.copy") }));
    const retry = await screen.findByRole("button", { name: t("richText.codeBlock.copyFailed") });
    expect(screen.queryByRole("button", { name: t("dialog.copiedAction") })).toBeNull();
    fireEvent.click(retry);
    await screen.findByRole("button", { name: t("dialog.copiedAction") });
  });

  it("leaves Mermaid fences with the diagram renderer", async () => {
    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const { container } = render(<LyraMarkdown content={'```mermaid\ngraph TD\nA --> B\n```'} />);
    await waitFor(() => expect(container.querySelector('[data-streamdown="mermaid-block"]')).not.toBeNull());
    expect(container.querySelector(".lyra-markdown-code-block")).toBeNull();
  });
});
