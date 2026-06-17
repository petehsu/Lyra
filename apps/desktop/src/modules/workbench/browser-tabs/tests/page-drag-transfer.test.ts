import { describe, expect, test } from "vitest";

import {
  clearPageDragCitationPayload,
  hasPageDragCitationPayload,
  hydrateActivePageDragCitationFromMain,
  readPageDragCitationPayload,
  registerPageDragCitationMainBridge,
  setActivePageDragCitationPayload,
  writePageDragCitationPayload
} from "../page-drag-transfer";

type DataTransferLike = {
  dropEffect: DataTransfer["dropEffect"];
  effectAllowed: DataTransfer["effectAllowed"];
  files: FileList;
  items: DataTransferItemList;
  types: string[];
  _store: Record<string, string>;
  clearData: () => void;
  getData: (type: string) => string;
  setData: (type: string, value: string) => void;
  setDragImage: () => void;
};

const createDataTransferMock = (): DataTransferLike => {
  const store: Record<string, string> = {};
  const dataTransfer: DataTransferLike = {
    dropEffect: "none",
    effectAllowed: "all",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    _store: store,
    clearData: () => {
      Object.keys(store).forEach((key) => delete store[key]);
      dataTransfer.types = [];
    },
    getData: (type: string) => store[type] ?? "",
    setData: (type: string, value: string) => {
      store[type] = value;
      dataTransfer.types = Object.keys(store);
    },
    setDragImage: () => undefined
  };
  return dataTransfer;
};

describe("page-drag-transfer", () => {
  test("hydrates active payload from the main-process bridge", () => {
    clearPageDragCitationPayload();
    registerPageDragCitationMainBridge({
      readActive: () => ({
        tabId: "tab-7",
        pageUrl: "https://example.com/post",
        pageTitle: "Post",
        selectionText: "hello"
      }),
      consume: () => undefined
    });

    const reader = createDataTransferMock();
    reader.types = ["text/plain"];

    expect(hydrateActivePageDragCitationFromMain()).toBe(true);
    expect(hasPageDragCitationPayload(reader as DataTransfer)).toBe(true);
    expect(readPageDragCitationPayload(reader as DataTransfer)?.selectionText).toBe("hello");
  });

  test("writes and reads page drag citation payloads", () => {
    clearPageDragCitationPayload();
    const dataTransfer = createDataTransferMock();
    writePageDragCitationPayload(dataTransfer, {
      tabId: "tab-42",
      pageUrl: "https://example.com/docs",
      pageTitle: "Docs",
      selectionText: "hello world",
      linkUrl: "https://example.com/a",
      linkText: "Read more",
      elementTag: "a",
      elementSelector: "a:nth-of-type(1)"
    });

    expect(hasPageDragCitationPayload(dataTransfer as DataTransfer)).toBe(true);
    expect(readPageDragCitationPayload(dataTransfer as DataTransfer)).toEqual({
      tabId: "tab-42",
      pageUrl: "https://example.com/docs",
      pageTitle: "Docs",
      selectionText: "hello world",
      linkUrl: "https://example.com/a",
      linkText: "Read more",
      elementTag: "a",
      elementSelector: "a:nth-of-type(1)"
    });
  });

  test("uses in-memory active payload when cross-view drag data is unavailable", () => {
    clearPageDragCitationPayload();
    const reader = createDataTransferMock();
    reader.types = ["text/plain", "text/html"];

    expect(hasPageDragCitationPayload(reader as DataTransfer)).toBe(false);

    setActivePageDragCitationPayload({
      tabId: "tab-42",
      pageUrl: "https://example.com/docs",
      pageTitle: "Docs",
      selectionText: "selected text",
      srcUrl: "https://example.com/avatar.png",
      mediaType: "image"
    });

    expect(hasPageDragCitationPayload(reader as DataTransfer)).toBe(true);
    expect(readPageDragCitationPayload(reader as DataTransfer)).toEqual({
      tabId: "tab-42",
      pageUrl: "https://example.com/docs",
      pageTitle: "Docs",
      selectionText: "selected text",
      srcUrl: "https://example.com/avatar.png",
      mediaType: "image"
    });
  });

  test("reads encoded plain-text fallback payloads on drop", () => {
    clearPageDragCitationPayload();
    const reader = createDataTransferMock();
    reader.setData(
      "text/plain",
      '⟦lyra-page-drag:{"tabId":"tab-9","pageUrl":"https://example.com","pageTitle":"Example","linkUrl":"https://example.com/item","linkText":"Item"}⟧'
    );

    const payload = readPageDragCitationPayload(reader as DataTransfer);
    expect(payload?.tabId).toBe("tab-9");
    expect(payload?.linkUrl).toBe("https://example.com/item");
    expect(payload?.linkText).toBe("Item");
  });
});