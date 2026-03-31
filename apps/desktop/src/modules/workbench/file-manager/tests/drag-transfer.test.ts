import { describe, expect, test } from "vitest";

import {
  clearFileManagerEntryDragPayload,
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
