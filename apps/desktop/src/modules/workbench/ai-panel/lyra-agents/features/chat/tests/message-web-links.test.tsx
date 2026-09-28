import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { MessageCitationText } from "../MessageCitationText";
import { LyraMarkdown } from "../../rich-text/LyraMarkdown";
import { PageCitationChipView } from "../PageCitationChipView";
import { createPageCitationChipElement } from "../citation-chip-dom";
import { buildWorkspaceTabPageCitation } from "../workspace-tab-citation";
import { composerWebLinks, messageWebLinksFromMetadata, splitMessageWebLinks } from "../message-web-links";
import { segmentsToPlainText, type ComposerSegment } from "../message-citation";
import { Message } from "../Message";
import { DataContextProvider } from "../../../data/DataProvider";
import { createDataProviderValue } from "../../../data/createDataProviderValue";

const url = "https://x.com/b_nnett/status/2091630242792112480";
const short = url.slice("https://".length);

describe("consistent web-link rendering", () => {
  test("the actual user-message bubble renders links even without citation markers", () => {
    const openUrlInWorkbench = vi.fn(async () => {});
    const message = { id: "user-link", author: "user" as const, blocks: [{ id: "body", type: "text" as const, body: `${url}把这个项目clone到Lyra的参考目录` }] };
    const value = createDataProviderValue({
      session: { title: "Test", project: "Lyra", workingDir: "/tmp", projectBound: false, workingDirIsHome: false, totalAdditions: 0, totalDeletions: 0 },
      messages: [message],
      openUrlInWorkbench
    });
    const { container } = render(<DataContextProvider value={value}><Message message={message} /></DataContextProvider>);
    const chip = screen.getByRole("button", { name: url });
    expect(chip.closest(".lyra-agents-message-bubble")).not.toBeNull();
    expect(container.textContent).not.toContain("https://");
    fireEvent.click(chip);
    expect(openUrlInWorkbench).toHaveBeenCalledWith(url);
  });

  test("renders legacy pasted links beside Chinese prose without consuming the instruction", () => {
    const open = vi.fn();
    const { container } = render(<MessageCitationText text={`${url}把这个项目clone到Lyra的参考目录`} onWebLinkClick={open} />);
    const chip = screen.getByRole("button", { name: url });
    expect(chip).toHaveTextContent(short);
    expect(container.textContent).toBe(`${short}把这个项目clone到Lyra的参考目录`);
    fireEvent.click(chip);
    expect(open).toHaveBeenCalledWith(url);
  });

  test("retains exact link boundaries across send and history restoration, including Unicode", () => {
    const unicodeUrl = "https://example.com/中文?q=a%2Fb#段落";
    const segments: ComposerSegment[] = [
      { type: "text", value: "  🙂" },
      { type: "link", url: unicodeUrl, label: "example.com" },
      { type: "text", value: "把这个页面打开  " }
    ];
    const text = segmentsToPlainText(segments).trim();
    const webLinks = composerWebLinks(segments, text);
    const restored = messageWebLinksFromMetadata(JSON.parse(JSON.stringify({ webLinks })));
    expect(restored).toEqual([{ start: 2, end: 2 + unicodeUrl.length, url: unicodeUrl }]);
    expect(splitMessageWebLinks(text, restored)).toEqual([
      { type: "text", value: "🙂" },
      { type: "link", url: unicodeUrl },
      { type: "text", value: "把这个页面打开" }
    ]);
    const { container } = render(<MessageCitationText text={text} webLinks={restored} />);
    expect(container.querySelector("[data-web-link-url]")).toHaveAttribute("data-web-link-url", unicodeUrl);
    expect(container.textContent).toBe(`🙂${unicodeUrl.slice(8)}把这个页面打开`);
  });

  test("uses the same short URL for a pasted link, dragged tab and Markdown link", () => {
    const citation = buildWorkspaceTabPageCitation({ id: "tab-1", pageKind: "page", title: url, displayAddress: url, inputValue: url, query: undefined, faviconUrl: undefined });
    const { container } = render(<>
      <MessageCitationText text={url} />
      <PageCitationChipView citation={citation} />
      <LyraMarkdown content={`[${url}](${url})`} />
    </>);
    const labels = [...container.querySelectorAll(".lyra-agents-citation-chip-preview")].map((node) => node.textContent);
    expect(labels).toEqual([short, short, short]);
    expect(createPageCitationChipElement(citation).textContent).toBe(short);
    expect(container.textContent).not.toContain("https://");
  });

  test("does not replace quoted page text or non-web references with an address", () => {
    const citation = buildWorkspaceTabPageCitation({ id: "tab-1", pageKind: "page", title: "Page", displayAddress: url, inputValue: url, query: undefined, faviconUrl: undefined });
    const { container } = render(<PageCitationChipView citation={{ ...citation, excerptKind: "selection", preview: "选中的原文" }} />);
    expect(container.textContent).toBe("选中的原文");
  });

  test("copies actual destinations from bubbles and Markdown, including clipped chips", () => {
    const { container } = render(<MessageCitationText text={`看看 ${url}\nhttps://example.com/path?q=1#part`} />);
    const range = document.createRange();
    range.selectNodeContents(container);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const setData = vi.fn();
    fireEvent.copy(document, { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith("text/plain", `看看 ${url}\nhttps://example.com/path?q=1#part`);
  });

  test("rejects unsafe metadata and ignores stale boundaries", () => {
    expect(messageWebLinksFromMetadata({ webLinks: [{ start: 0, end: 19, url: "javascript:alert(1)" }] })).toEqual([]);
    expect(splitMessageWebLinks("just text", [{ start: 0, end: 3, url }])).toEqual([{ type: "text", value: "just text" }]);
    expect(splitMessageWebLinks("(https://example.com/wiki/A_(B)).")).toEqual([
      { type: "text", value: "(" }, { type: "link", url: "https://example.com/wiki/A_(B)" }, { type: "text", value: ")." }
    ]);
  });
});
