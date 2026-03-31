import { describe, expect, test } from "vitest";

import {
  hasTerminalTabDragPayload,
  readTerminalTabDragPayload,
  writeTerminalTabDragPayload
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

describe("terminal drag transfer", () => {
  test("writes and reads terminal tab payload", () => {
    const dataTransfer = createDataTransferMock();
    writeTerminalTabDragPayload(dataTransfer as DataTransfer, {
      source: "dock",
      tabId: "tab-1"
    });

    expect(hasTerminalTabDragPayload(dataTransfer as DataTransfer)).toBe(true);
    expect(readTerminalTabDragPayload(dataTransfer as DataTransfer)).toEqual({
      source: "dock",
      tabId: "tab-1"
    });
    expect(dataTransfer.effectAllowed).toBe("move");
  });

  test("returns null for invalid payload", () => {
    const dataTransfer = createDataTransferMock();
    dataTransfer.setData(
      "application/x-lyra-terminal-tab",
      "{\"source\":\"bad\",\"tabId\":\"x\"}"
    );

    expect(readTerminalTabDragPayload(dataTransfer as DataTransfer)).toBeNull();
  });
});
