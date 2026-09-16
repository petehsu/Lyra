import { describe, expect, test } from "vitest";

import {
  clearFileManagerEntryDragPayload,
  hasAttachableFileManagerEntryDragPayload,
  hasFileManagerEntryDragPayload,
  readFileManagerEntryDragPayload,
  writeFileManagerEntryDragPayload
} from "../drag-transfer";

type DataTransferLike = Pick<DataTransfer, "types" | "setData" | "getData" | "effectAllowed">;

const createDataTransferMock = (): DataTransferLike => {
  const store = new Map<string, string>();
  const dataTransfer: DataTransferLike = {
    effectAllowed: "all",
    get types() {
      return Array.from(store.keys());
    },
    setData(format, value) {
      store.set(format, value);
    },
    getData(format) {
      return store.get(format) ?? "";
    }
  };
  return dataTransfer;
};

describe("file-manager drag transfer", () => {
  test("writes and reads file-manager entry payload", () => {
    clearFileManagerEntryDragPayload();
    const dataTransfer = createDataTransferMock();
    writeFileManagerEntryDragPayload(dataTransfer as DataTransfer, {
      name: "README.md",
      kind: "file",
      source: "directory",
      path: "/workspace/README.md"
    });

    expect(hasFileManagerEntryDragPayload(dataTransfer as DataTransfer)).toBe(true);
    expect(readFileManagerEntryDragPayload(dataTransfer as DataTransfer)).toEqual({
      name: "README.md",
      kind: "file",
      source: "directory",
      path: "/workspace/README.md"
    });
    expect(dataTransfer.effectAllowed).toBe("copy");
  });

  test("does not treat pathless trash entries as attachable", () => {
    clearFileManagerEntryDragPayload();
    const dataTransfer = createDataTransferMock();
    writeFileManagerEntryDragPayload(dataTransfer as DataTransfer, {
      name: "gone.txt",
      kind: "file",
      source: "trash"
    });

    expect(hasFileManagerEntryDragPayload(dataTransfer as DataTransfer)).toBe(true);
    expect(hasAttachableFileManagerEntryDragPayload(dataTransfer as DataTransfer)).toBe(false);
    expect(readFileManagerEntryDragPayload(dataTransfer as DataTransfer)).toEqual({
      name: "gone.txt",
      kind: "file",
      source: "trash"
    });
  });

  test("returns null for invalid payload", () => {
    clearFileManagerEntryDragPayload();
    const dataTransfer = createDataTransferMock();
    dataTransfer.setData(
      "application/x-lyra-file-manager-entry",
      "{\"name\":\"\",\"kind\":\"file\",\"source\":\"directory\"}"
    );

    expect(readFileManagerEntryDragPayload(dataTransfer as DataTransfer)).toBeNull();
  });
});
