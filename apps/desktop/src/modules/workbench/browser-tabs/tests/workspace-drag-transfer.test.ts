import { describe, expect, test } from "vitest";

import {
  clearWorkspaceTabDragPayload,
  hasWorkspaceTabDragPayload,
  readWorkspaceTabDragPayload,
  writeWorkspaceTabDragPayload
} from "../workspace-drag-transfer";

type MockDataTransfer = DataTransfer & {
  _store: Record<string, string>;
};

const createDataTransfer = (): MockDataTransfer => {
  const store: Record<string, string> = {};
  const types: string[] = [];
  return {
    _store: store,
    dropEffect: "none",
    effectAllowed: "none",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types,
    clearData: (format?: string) => {
      if (format === undefined) {
        for (const key of Object.keys(store)) {
          delete store[key];
        }
        types.length = 0;
        return;
      }
      delete store[format];
      const nextTypes = Object.keys(store);
      types.length = 0;
      types.push(...nextTypes);
    },
    getData: (format: string) => store[format] ?? "",
    setData: (format: string, data: string) => {
      store[format] = data;
      if (types.includes(format) === false) {
        types.push(format);
      }
    },
    setDragImage: () => undefined
  } as unknown as MockDataTransfer;
};

describe("workspace tab drag transfer", () => {
  test("writes and reads payload", () => {
    clearWorkspaceTabDragPayload();
    const dataTransfer = createDataTransfer();

    writeWorkspaceTabDragPayload(dataTransfer, " tab-1 ");
    expect(dataTransfer.effectAllowed).toBe("move");
    expect(hasWorkspaceTabDragPayload(dataTransfer)).toBe(true);
    expect(readWorkspaceTabDragPayload(dataTransfer)).toEqual({
      tabId: "tab-1",
      intent: "reorder"
    });
  });

  test("uses in-memory fallback payload when getData is empty", () => {
    clearWorkspaceTabDragPayload();
    const writer = createDataTransfer();
    writeWorkspaceTabDragPayload(writer, "tab-in-memory", "split");

    const reader = createDataTransfer();
    expect(readWorkspaceTabDragPayload(reader)).toEqual({
      tabId: "tab-in-memory",
      intent: "split"
    });

    clearWorkspaceTabDragPayload();
    expect(readWorkspaceTabDragPayload(reader)).toBeNull();
  });

  test("returns null for invalid payload", () => {
    clearWorkspaceTabDragPayload();
    const dataTransfer = createDataTransfer();
    dataTransfer.setData("application/x-lyra-workspace-tab", "{\"tabId\":\"   \"}");

    expect(readWorkspaceTabDragPayload(dataTransfer)).toBeNull();
  });
});
