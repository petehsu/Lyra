import { useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { CitationComposerInput, type CitationComposerInputHandle } from "../CitationComposerInput";
import { segmentsToPlainText, type ComposerSegment } from "../message-citation";

vi.mock("../page-citation-tab-icon", () => ({
  mountPageCitationTabIcon: vi.fn(),
  mountWebsiteLinkIcon: vi.fn()
}));

const LinkComposer = ({
  onLinkClick,
  onSend,
  initialSegments = []
}: {
  readonly onLinkClick?: (url: string, title?: string) => void;
  readonly onSend?: (text: string) => void;
  readonly initialSegments?: ComposerSegment[];
}) => {
  const [segments, setSegments] = useState<ComposerSegment[]>(initialSegments);
  const inputRef = useRef<CitationComposerInputHandle>(null);
  return (
    <CitationComposerInput
      ref={inputRef}
      segments={segments}
      placeholder="Message"
      onSegmentsChange={setSegments}
      onSubmit={() => onSend?.(segmentsToPlainText(inputRef.current?.readSegments() ?? segments))}
      {...(onLinkClick === undefined ? {} : { onLinkClick })}
    />
  );
};

const textClipboard = (text: string) => ({
  items: [],
  getData: (type: string) => type === "text/plain" ? text : ""
});

describe("composer link chips", () => {
  test("turns a pasted HTTP URL into an openable chip", () => {
    const onLinkClick = vi.fn();
    const { container } = render(<LinkComposer onLinkClick={onLinkClick} />);
    const editor = screen.getByRole("textbox", { name: "Message" });

    fireEvent.paste(editor, {
      clipboardData: textClipboard("https://docs.example.com/guide?mode=full#start")
    });

    const chip = container.querySelector<HTMLElement>("[data-link-url]");
    expect(chip).not.toBeNull();
    expect(chip?.dataset.linkUrl).toBe("https://docs.example.com/guide?mode=full#start");
    expect(chip?.textContent).toBe("docs.example.com/guide?mode=full#start");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(path);
    chip?.appendChild(svg);
    fireEvent.mouseDown(path);
    expect(onLinkClick).toHaveBeenCalledWith(
      "https://docs.example.com/guide?mode=full#start",
      "docs.example.com/guide?mode=full#start"
    );
  });

  test.each([
    "https://x.com/b_nnett/status/2091630242792112480",
    "https://docs.example.com/guide?mode=full&name=a%2Fb#start"
  ])("shortens only the display, keeping the full pasted URL for copying and submission: %s", (url) => {
    const onSend = vi.fn();
    render(<LinkComposer initialSegments={[{ type: "text", value: "把" }]} onSend={onSend} />);
    const editor = screen.getByRole("textbox", { name: "Message" });
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    fireEvent.paste(editor, { clipboardData: textClipboard(url) });

    expect(editor.textContent).toBe(`把${url.replace(/^https:\/\//u, "")}`);
    range.selectNodeContents(editor);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const setData = vi.fn();
    fireEvent.copy(editor, { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith("text/plain", `把${url}`);
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith(`把${url}`);
  });

  test("restored drafts use the current short-link display even with an old hostname label", () => {
    const url = "https://x.com/b_nnett/status/2091630242792112480";
    render(<LinkComposer initialSegments={[{ type: "link", url, label: "x.com" }]} />);
    expect(screen.getByRole("textbox", { name: "Message" }).textContent).toBe(url.replace(/^https:\/\//u, ""));
  });

  test("recognizes multiple URLs pasted together with prose and newlines", () => {
    const onSend = vi.fn();
    const { container } = render(<LinkComposer onSend={onSend} />);
    const editor = screen.getByRole("textbox", { name: "Message" });
    const text = "Read https://example.com/docs\n再看 https://x.com/test。";
    fireEvent.paste(editor, { clipboardData: textClipboard(text) });
    expect(container.querySelectorAll("[data-link-url]")).toHaveLength(2);
    expect(editor.textContent).not.toContain("https://");
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith(text);
  });

  test("copies full URLs on cut and removes the selected content", () => {
    render(<LinkComposer initialSegments={[{ type: "link", url: "https://example.com/path", label: "example.com" }]} />);
    const editor = screen.getByRole("textbox", { name: "Message" });
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const setData = vi.fn();
    fireEvent.cut(editor, { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith("text/plain", "https://example.com/path");
    expect(editor.textContent).toBe("");
  });

  test("leaves unsafe pasted text alone", () => {
    const { container } = render(<LinkComposer />);
    const editor = screen.getByRole("textbox", { name: "Message" });

    expect(fireEvent.paste(editor, { clipboardData: textClipboard("javascript:alert(1)") })).toBe(true);
    expect(container.querySelector("[data-link-url]")).toBeNull();
  });

  test("keeps image paste ahead of a simultaneous URL payload", () => {
    const { container } = render(<LinkComposer />);
    const editor = screen.getByRole("textbox", { name: "Message" });
    const clipboardData = {
      items: [{ type: "image/png", getAsFile: () => null }],
      getData: (type: string) => type === "text/plain" ? "https://example.com/image.png" : ""
    };

    expect(fireEvent.paste(editor, { clipboardData })).toBe(false);
    expect(container.querySelector("[data-link-url]")).toBeNull();
  });

  test("turns a completed typed URL into a chip at the space boundary", () => {
    const { container } = render(<LinkComposer />);
    const editor = screen.getByRole("textbox", { name: "Message" });
    editor.textContent = "See https://example.com/docs";
    const text = editor.firstChild;
    expect(text).toBeInstanceOf(Text);
    const range = document.createRange();
    range.setStart(text!, text?.textContent?.length ?? 0);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    fireEvent.keyDown(editor, { key: " " });

    expect(container.querySelector("[data-link-url='https://example.com/docs']")).not.toBeNull();
    expect(editor.textContent).toBe("See example.com/docs ");
  });
});
