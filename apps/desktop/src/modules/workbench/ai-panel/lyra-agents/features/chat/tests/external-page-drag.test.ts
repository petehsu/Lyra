import { describe, expect, test } from "vitest";

import {
  hasExternalPageDragPayload,
  readExternalPageDragPayload
} from "../external-page-drag";

const createDataTransferMock = (): DataTransfer & {
  readonly store: Map<string, string>;
  types: string[];
} => {
  const store = new Map<string, string>();
  const mock = {
    dropEffect: "none" as DataTransfer["dropEffect"],
    effectAllowed: "all" as DataTransfer["effectAllowed"],
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [] as string[],
    store,
    clearData: () => {
      store.clear();
    },
    getData: (type: string) => store.get(type) ?? "",
    setData: (type: string, value: string) => {
      store.set(type, value);
      if (!mock.types.includes(type)) {
        mock.types = [...mock.types, type];
      }
    },
    setDragImage: () => undefined
  };
  return mock as DataTransfer & {
    readonly store: Map<string, string>;
    types: string[];
  };
};

describe("external-page-drag", () => {
  test("parses uri-list link drags into external page payload", () => {
    const transfer = createDataTransferMock();
    transfer.types = ["text/uri-list", "text/plain"];
    transfer.setData("text/uri-list", "https://example.com/docs\r\n");
    transfer.setData("text/plain", "https://example.com/docs");

    expect(hasExternalPageDragPayload(transfer)).toBe(true);
    const payload = readExternalPageDragPayload(transfer);
    expect(payload).toEqual({
      pageUrl: "https://example.com/docs",
      pageTitle: "example.com",
      captureFidelity: "url-only"
    });
  });

  test("parses html link drags with anchor text", () => {
    const transfer = createDataTransferMock();
    transfer.types = ["text/html", "text/uri-list", "text/plain"];
    transfer.setData("text/uri-list", "https://example.com/item\r\n");
    transfer.setData(
      "text/html",
      '<meta charset="utf-8"><a href="https://example.com/item">Read more</a>'
    );
    transfer.setData("text/plain", "Read more");

    const payload = readExternalPageDragPayload(transfer);
    expect(payload).toMatchObject({
      pageUrl: "https://example.com/item",
      pageTitle: "Read more",
      linkUrl: "https://example.com/item",
      linkText: "Read more",
      mediaType: "link",
      elementTag: "a",
      captureFidelity: "html-parsed"
    });
  });

  test("ignores lyra internal encoded page drags", () => {
    const transfer = createDataTransferMock();
    transfer.types = ["text/plain"];
    transfer.setData(
      "text/plain",
      '⟦lyra-page-drag:{"tabId":"tab-1","pageUrl":"https://example.com","pageTitle":"Example"}⟧'
    );

    expect(readExternalPageDragPayload(transfer)).toBeNull();
  });

  test("ignores file drags even when uri-list is present", () => {
    const file = new File(["x"], "note.txt", { type: "text/plain" });
    const transfer = {
      ...createDataTransferMock(),
      files: [file] as unknown as FileList,
      types: ["Files", "text/uri-list"],
      getData: (type: string) => (type === "text/uri-list" ? "https://example.com" : ""),
    } as DataTransfer;

    expect(readExternalPageDragPayload(transfer)).toBeNull();
  });
});