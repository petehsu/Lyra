import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { CitationComposerInput } from "../CitationComposerInput";
import type { ComposerSegment } from "../message-citation";

vi.mock("../page-citation-tab-icon", () => ({
  mountPageCitationTabIcon: vi.fn(),
  mountWebsiteLinkIcon: vi.fn()
}));

const LinkComposer = ({
  onLinkClick
}: {
  readonly onLinkClick?: (url: string, title?: string) => void;
}) => {
  const [segments, setSegments] = useState<ComposerSegment[]>([]);
  return (
    <CitationComposerInput
      segments={segments}
      placeholder="Message"
      onSegmentsChange={setSegments}
      onSubmit={() => undefined}
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
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(path);
    chip?.appendChild(svg);
    fireEvent.mouseDown(path);
    expect(onLinkClick).toHaveBeenCalledWith(
      "https://docs.example.com/guide?mode=full#start",
      "docs.example.com"
    );
  });

  test.each([
    "Read https://example.com/docs",
    "javascript:alert(1)"
  ])("leaves non-standalone or unsafe pasted text alone: %s", (text) => {
    const { container } = render(<LinkComposer />);
    const editor = screen.getByRole("textbox", { name: "Message" });

    expect(fireEvent.paste(editor, { clipboardData: textClipboard(text) })).toBe(true);
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
    expect(editor.textContent).toBe("See example.com ");
  });
});
