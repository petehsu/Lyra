import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "@workbench/i18n";
import type { ChatMessage, MessageBlock, SessionMeta } from "../../../core/types";
import { createDataProviderValue } from "../../../data/createDataProviderValue";
import { DataContextProvider } from "../../../data/DataProvider";
import { getStreamStore, resetStreamStore } from "../../../../../agent-session-view-model/stream-store";
import { LyraMarkdown } from "../../rich-text/LyraMarkdown";
import { MessageTextBlock } from "../message-text-block";

const session: SessionMeta = {
  title: "Test", project: "Lyra", workingDir: "/tmp", projectBound: true,
  workingDirIsHome: false, totalAdditions: 0, totalDeletions: 0
};
const citeLabel = () => t("lyra-agents-message.citeSelection");

function mount(body: string, streaming = false) {
  // Merged turns can display a different message/block id than the live source.
  const block: Extract<MessageBlock, { type: "text" }> = {
    id: "display-block", type: "text", body,
    sourceMessageId: "source-message", sourceBlockId: "source-block"
  };
  const message: ChatMessage = { id: "display-message", author: "agent", time: "12:00", blocks: [block] };
  const addCitationToComposer = vi.fn();
  const data = createDataProviderValue({ session, messages: [message], addCitationToComposer });
  const view = render(
    <DataContextProvider value={data}>
      <div data-message-id={message.id}>
        <MessageTextBlock message={message} block={block} streaming={streaming} />
      </div>
    </DataContextProvider>
  );
  return { ...view, addCitationToComposer };
}

describe("Markdown block citations", () => {
  beforeEach(() => resetStreamStore());

  it("quotes only the chosen code fence through the existing transcript action", async () => {
    const { container, addCitationToComposer } = mount('Before\n\n```ts\nconst a = 1;\n```\n\nBetween\n\n```ts\nconst b = 2;\nconsole.log(b);\n```\n\nAfter');
    await waitFor(() => expect(container.querySelector('code span[style]')).not.toBeNull());
    const blocks = container.querySelectorAll<HTMLElement>(".lyra-markdown-code-block");
    fireEvent.click(within(blocks[1]!).getByRole("button", { name: citeLabel() }));
    expect(addCitationToComposer).toHaveBeenCalledOnce();
    expect(addCitationToComposer.mock.calls[0]![0]).toMatchObject({
      messageId: "display-message", blockId: "display-block", role: "assistant",
      excerptKind: "selection", quotedText: "const b = 2;\nconsole.log(b);",
      truncated: false, sourceCreatedAt: "12:00"
    });
    const citation = addCitationToComposer.mock.calls[0]![0];
    const prefix = document.createRange();
    prefix.selectNodeContents(container.querySelector("[data-message-block-id]")!);
    prefix.setEndBefore(blocks[1]!.querySelector("pre code")!);
    expect(citation.startOffset).toBe(prefix.toString().length);
    expect(citation.endOffset).toBeGreaterThan(citation.startOffset);
    expect(window.getSelection()?.isCollapsed).toBe(true);
  });

  it("quotes the latest live code even before the message snapshot catches up", async () => {
    const { container, addCitationToComposer } = mount('```js\nconst value = 1;', true);
    act(() => {
      getStreamStore().appendDelta("source-message", "source-block", '```js\nconst value = 12;\nconsole.log(value);', true);
      getStreamStore().flush();
    });
    await waitFor(() => expect(container.querySelector("code")?.textContent).toContain("console.log"));
    fireEvent.click(screen.getByRole("button", { name: citeLabel() }));
    expect(addCitationToComposer.mock.calls[0]![0].quotedText).toBe("const value = 12;\nconsole.log(value);");
  });

  it("keeps table cells and escaped pipes separate without quoting surrounding text", () => {
    const { addCitationToComposer } = mount('Before\n\n| Module | Progress |\n| :--- | ---: |\n| **A** \\| B | 92% |\n| Backend | 78% |\n\nAfter');
    fireEvent.click(screen.getByRole("button", { name: citeLabel() }));
    const citation = addCitationToComposer.mock.calls[0]![0];
    expect(citation.quotedText).toBe('| Module | Progress |\n| --- | --- |\n| A \\| B | 92% |\n| Backend | 78% |');
    expect(citation).toMatchObject({ messageId: "display-message", blockId: "display-block", excerptKind: "selection" });
    expect(screen.getByRole("columnheader", { name: "Progress" })).toHaveStyle({ textAlign: "right" });
  });

  it("uses the existing long-quote limit and marks truncation", () => {
    const code = "示例🙂".repeat(200);
    const { addCitationToComposer } = mount(`\`\`\`text\n${code}\n\`\`\``);
    fireEvent.click(screen.getByRole("button", { name: citeLabel() }));
    expect(addCitationToComposer.mock.calls[0]![0]).toMatchObject({
      quotedText: Array.from(code).slice(0, 480).join(""), truncated: true
    });
  });

  it("does not offer transcript actions in standalone document previews", () => {
    render(<LyraMarkdown content={'```js\nconst x = 1;\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'} />);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByRole("button", { name: citeLabel() })).toBeNull();
  });
});
