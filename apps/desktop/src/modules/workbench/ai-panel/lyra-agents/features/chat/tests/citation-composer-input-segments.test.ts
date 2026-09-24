import { describe, expect, test } from "vitest";

import { parseEditorSegments } from "../CitationComposerInput";
import { createComposerChipElement } from "../citation-chip-dom";
import type { AgentImageAttachment } from "../../../core/types";

/**
 * Regression guard for drag/paste image inserts: chips must round-trip into segments
 * via known-segment parsing (see CitationComposerInput insertImage).
 */
describe("citation composer chip segments", () => {
  test("link chips preserve their URL, label, and known favicon", () => {
    const link = {
      type: "link",
      url: "https://docs.example.com/guide",
      label: "docs.example.com",
      faviconUrl: "https://docs.example.com/favicon.ico"
    } as const;
    const root = document.createElement("div");
    root.append("Open ");
    root.appendChild(createComposerChipElement(link));

    expect(parseEditorSegments(root, [link])).toEqual([
      { type: "text", value: "Open " },
      link
    ]);
  });

  test("image chips carry attachment id for known-segment parsing", () => {
    const image: AgentImageAttachment = {
      id: "dropped-image-test",
      mediaType: "image/png",
      data: "abc",
      label: "Screen Shot.png",
      source: "/Users/demo/Desktop/Screen Shot.png"
    };
    const chip = createComposerChipElement({ type: "image", image });
    expect(chip.dataset.attachmentId).toBe("dropped-image-test");
    expect(chip.dataset.attachmentSource).toBe("/Users/demo/Desktop/Screen Shot.png");
  });

  test("file chips use the file-type icon for the attachment name", () => {
    const chip = (name: string) => createComposerChipElement({
      type: "file",
      file: {
        id: name,
        path: `/tmp/${name}`,
        name,
        preview: name
      }
    });
    const iconId = (name: string) =>
      chip(name).querySelector(".lyra-agents-citation-chip-icon")?.getAttribute("data-file-type");
    expect(iconId("任务书.docx")).toBe("vscode-icons:file-type-word");
    expect(iconId("答辩.pptx")).toBe("vscode-icons:file-type-powerpoint");
    expect(iconId("表.xlsx")).toBe("vscode-icons:file-type-excel");
    expect(iconId("notes.bin")).toMatch(/^vscode-icons:/u);
    const folder = createComposerChipElement({
      type: "file",
      file: {
        id: "web",
        path: "/tmp/web",
        name: "web",
        preview: "web",
        kind: "directory"
      }
    });
    expect(folder.querySelector(".lyra-agents-citation-chip-icon")?.getAttribute("data-file-type"))
      .toBe("vscode-icons:folder-type-www");
    expect(folder.dataset.fileKind).toBe("directory");
  });

  test("nested chips still round-trip as segments", () => {
    const image: AgentImageAttachment = {
      id: "nested-image-test",
      mediaType: "image/png",
      data: "abc",
      label: "Nested.png",
      source: "/tmp/Nested.png"
    };
    const root = document.createElement("div");
    const wrapper = document.createElement("span");
    wrapper.appendChild(createComposerChipElement({ type: "image", image }));
    root.append("See ");
    root.appendChild(wrapper);

    expect(parseEditorSegments(root, [{ type: "image", image }])).toEqual([
      { type: "text", value: "See " },
      { type: "image", image }
    ]);
  });
});
