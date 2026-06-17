import { describe, expect, test } from "vitest";

import {
  clearWorkspaceTabDragPayload,
  writeWorkspaceTabDragPayload
} from "../../../../../browser-tabs/workspace-drag-transfer";
import type { WorkspaceTab } from "../../../../../workspace-tabs/types";
import {
  isAiPanelAttachDrag,
  resolveAiPanelDragAttachAction,
  resolveAiPanelDropEffect
} from "../ai-panel-drag-attach";
import {
  clearTerminalTabDragPayload,
  writeTerminalTabDragPayload
} from "../../../../../terminal-dock/drag-transfer";
import {
  clearFileManagerEntryDragPayload,
  writeFileManagerEntryDragPayload
} from "../../../../../file-manager/drag-transfer";
import {
  clearPageDragCitationPayload,
  writePageDragCitationPayload
} from "../../../../../browser-tabs/page-drag-transfer";

const createEmptyDataTransfer = (): DataTransfer => ({
  dropEffect: "none",
  effectAllowed: "all",
  files: [] as unknown as FileList,
  items: [] as unknown as DataTransferItemList,
  types: [],
  clearData: () => undefined,
  getData: () => "",
  setData: () => undefined,
  setDragImage: () => undefined
} as DataTransfer);

const workspaceTab = (id: string): WorkspaceTab => ({
  id,
  title: `Tab ${id}`,
  pageKind: "page",
  inputValue: "",
  displayAddress: `https://example.com/${id}`,
  faviconUrl: undefined,
  query: undefined
});

describe("ai-panel-drag-attach", () => {
  test("resolves workspace tab drag via in-memory fallback when getData is empty", async () => {
    clearWorkspaceTabDragPayload();
    const writer = createEmptyDataTransfer();
    writeWorkspaceTabDragPayload(writer, "tab-42");

    const reader = createEmptyDataTransfer();
    const action = await resolveAiPanelDragAttachAction(
      reader,
      [workspaceTab("tab-42")],
      []
    );

    expect(action).toEqual({
      kind: "workspace-tab",
      tab: workspaceTab("tab-42")
    });
  });

  test("returns null after in-memory payload is cleared before resolve", async () => {
    clearWorkspaceTabDragPayload();
    const writer = createEmptyDataTransfer();
    writeWorkspaceTabDragPayload(writer, "tab-42");

    const reader = createEmptyDataTransfer();
    clearWorkspaceTabDragPayload();

    const action = await resolveAiPanelDragAttachAction(
      reader,
      [workspaceTab("tab-42")],
      []
    );

    expect(action).toBeNull();
  });

  test("resolves page drag citations into page citation chips", async () => {
    clearPageDragCitationPayload();
    const writer = createEmptyDataTransfer();
    writePageDragCitationPayload(writer, {
      tabId: "tab-42",
      pageUrl: "https://example.com/docs",
      pageTitle: "Docs",
      selectionText: "selected text",
      elementTag: "p",
      elementSelector: "article > p:nth-of-type(2)"
    });

    const reader = createEmptyDataTransfer();
    const action = await resolveAiPanelDragAttachAction(
      reader,
      [workspaceTab("tab-42")],
      []
    );

    expect(action?.kind).toBe("page-citation");
    if (action?.kind === "page-citation") {
      expect(action.citation.tabId).toBe("tab-42");
      expect(action.citation.pageUrl).toBe("https://example.com/docs");
      expect(action.citation.excerptKind).toBe("selection");
      expect(action.citation.elementSelector).toBe("article > p:nth-of-type(2)");
      expect(action.citation.sourceKind).toBe("browser");
    }
  });

  test("treats image paths from file manager as file citations", async () => {
    clearFileManagerEntryDragPayload();
    clearPageDragCitationPayload();
    const writer = createEmptyDataTransfer();
    writeFileManagerEntryDragPayload(writer, {
      name: "photo.png",
      kind: "file",
      source: "directory",
      path: "/Users/demo/Lyra/photo.png",
      iconKind: "image"
    });

    const reader = createEmptyDataTransfer();
    const action = await resolveAiPanelDragAttachAction(reader, [], []);

    expect(action?.kind).toBe("file");
    if (action?.kind === "file") {
      expect(action.file.path).toBe("/Users/demo/Lyra/photo.png");
      expect(action.file.name).toBe("photo.png");
    }
  });

  test("recognizes file manager entry drags", async () => {
    clearFileManagerEntryDragPayload();
    clearPageDragCitationPayload();
    const writer = createEmptyDataTransfer();
    writeFileManagerEntryDragPayload(writer, {
      name: "README.md",
      kind: "file",
      source: "directory",
      path: "/Users/demo/Lyra/README.md"
    });

    const reader = createEmptyDataTransfer();
    expect(isAiPanelAttachDrag(reader)).toBe(true);
    expect(resolveAiPanelDropEffect(reader)).toBe("copy");

    const action = await resolveAiPanelDragAttachAction(reader, [], []);
    expect(action?.kind).toBe("file");
    if (action?.kind === "file") {
      expect(action.file.path).toBe("/Users/demo/Lyra/README.md");
      expect(action.file.name).toBe("README.md");
    }
  });

  test("resolves external browser link drags into page citations", async () => {
    clearPageDragCitationPayload();
    clearFileManagerEntryDragPayload();

    const dataTransfer = {
      ...createEmptyDataTransfer(),
      types: ["text/uri-list", "text/plain", "text/html"],
      getData: (type: string) => {
        if (type === "text/uri-list") {
          return "https://docs.example.com/guide\r\n";
        }
        if (type === "text/html") {
          return '<a href="https://docs.example.com/guide">Guide</a>';
        }
        if (type === "text/plain") {
          return "Guide";
        }
        return "";
      }
    } as DataTransfer;

    expect(isAiPanelAttachDrag(dataTransfer)).toBe(true);
    expect(resolveAiPanelDropEffect(dataTransfer)).toBe("copy");

    const action = await resolveAiPanelDragAttachAction(dataTransfer, [], []);
    expect(action?.kind).toBe("page-citation");
    if (action?.kind === "page-citation") {
      expect(action.citation.sourceKind).toBe("external-browser");
      expect(action.citation.tabId.startsWith("external-page-")).toBe(true);
      expect(action.citation.pageUrl).toBe("https://docs.example.com/guide");
      expect(action.citation.linkText).toBe("Guide");
      expect(action.citation.captureFidelity).toBe("html-parsed");
    }
  });

  test("resolves external file drops with electron file paths", async () => {
    clearFileManagerEntryDragPayload();
    clearPageDragCitationPayload();

    const readme = new File(["# readme"], "README.md", { type: "text/markdown" });
    Object.defineProperty(readme, "path", {
      value: "/Users/demo/Projects/Lyra/README.md"
    });

    const dataTransfer = {
      ...createEmptyDataTransfer(),
      files: [readme] as unknown as FileList,
      types: ["Files"]
    } as DataTransfer;

    const action = await resolveAiPanelDragAttachAction(dataTransfer, [], []);
    expect(action?.kind).toBe("file");
    if (action?.kind === "file") {
      expect(action.file.path).toBe("/Users/demo/Projects/Lyra/README.md");
      expect(action.file.name).toBe("README.md");
    }
  });

  test("resolves multiple external file drops as file attachments", async () => {
    clearFileManagerEntryDragPayload();
    clearPageDragCitationPayload();

    const first = new File(["a"], "a.ts", { type: "text/plain" });
    Object.defineProperty(first, "path", { value: "/Users/demo/a.ts" });
    const second = new File(["b"], "b.ts", { type: "text/plain" });
    Object.defineProperty(second, "path", { value: "/Users/demo/b.ts" });

    const dataTransfer = {
      ...createEmptyDataTransfer(),
      files: [first, second] as unknown as FileList,
      types: ["Files"]
    } as DataTransfer;

    const action = await resolveAiPanelDragAttachAction(dataTransfer, [], []);
    expect(action?.kind).toBe("files");
    if (action?.kind === "files") {
      expect(action.files.map((file) => file.path)).toEqual([
        "/Users/demo/a.ts",
        "/Users/demo/b.ts"
      ]);
    }
  });

  test("prefers file manager payload path over external files list", async () => {
    clearFileManagerEntryDragPayload();
    clearPageDragCitationPayload();

    const writer = createEmptyDataTransfer();
    writeFileManagerEntryDragPayload(writer, {
      name: "service.ts",
      kind: "file",
      source: "directory",
      path: "/Users/demo/Lyra/service.ts"
    });

    const external = new File(["x"], "other.ts", { type: "text/plain" });
    Object.defineProperty(external, "path", { value: "/Users/demo/other.ts" });
    const reader = {
      ...createEmptyDataTransfer(),
      files: [external] as unknown as FileList,
      types: ["Files", "application/x-lyra-file-manager-entry"]
    } as DataTransfer;

    const action = await resolveAiPanelDragAttachAction(reader, [], []);
    expect(action?.kind).toBe("file");
    if (action?.kind === "file") {
      expect(action.file.path).toBe("/Users/demo/Lyra/service.ts");
    }
  });

  test("routes external screenshots to image attachments instead of file citations", async () => {
    clearFileManagerEntryDragPayload();
    clearPageDragCitationPayload();

    const pngBytes = Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82
    ]);
    const screenshot = new File([pngBytes], "Screen Shot 2026-06-17.png", { type: "image/png" });
    Object.defineProperty(screenshot, "arrayBuffer", {
      value: async () => pngBytes.buffer
    });
    Object.defineProperty(screenshot, "path", {
      value: "/Users/demo/Desktop/Screen Shot 2026-06-17.png"
    });

    const dataTransfer = {
      ...createEmptyDataTransfer(),
      files: [screenshot] as unknown as FileList,
      types: ["Files"]
    } as DataTransfer;

    const action = await resolveAiPanelDragAttachAction(dataTransfer, [], []);
    expect(action?.kind).toBe("images");
    if (action?.kind === "images") {
      expect(action.images).toHaveLength(1);
      expect(action.images[0]?.label).toContain("Screen Shot");
    }
  });

  test("uses move drop effect for internal tab drags", () => {
    clearWorkspaceTabDragPayload();
    clearTerminalTabDragPayload();
    clearFileManagerEntryDragPayload();
    clearPageDragCitationPayload();

    const workspaceTransfer = createEmptyDataTransfer();
    writeWorkspaceTabDragPayload(workspaceTransfer, "tab-1");
    expect(resolveAiPanelDropEffect(workspaceTransfer)).toBe("move");

    const terminalTransfer = createEmptyDataTransfer();
    writeTerminalTabDragPayload(terminalTransfer, { source: "dock", tabId: "term-1" });
    expect(resolveAiPanelDropEffect(terminalTransfer)).toBe("move");

    const fileTransfer = {
      ...createEmptyDataTransfer(),
      types: ["Files"]
    } as DataTransfer;
    expect(resolveAiPanelDropEffect(fileTransfer)).toBe("copy");
  });
});