import { describe, expect, test } from "vitest";

import {
  hasTerminalTabDragPayload,
  readTerminalTabDragPayload,
  setTerminalTabDragImage,
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

  test("drag image is an opaque copy of the tab, not the tab still in the strip", () => {
    const source = document.createElement("div");
    source.textContent = "Settings";
    source.style.opacity = "0.4";
    document.body.append(source);
    const images: HTMLElement[] = [];
    const dataTransfer = {
      setDragImage(element: HTMLElement) {
        images.push(element);
      }
    };

    setTerminalTabDragImage(dataTransfer as unknown as DataTransfer, source, 8, 4);

    const ghost = images[0];
    expect(ghost).toBeInstanceOf(HTMLElement);
    expect(ghost).not.toBe(source);
    expect(ghost?.style.opacity).toBe("1");
    expect(ghost?.style.background).toBe("var(--lyra-app-surface-strong-bg)");
    expect(ghost?.textContent).toBe("Settings");
    source.remove();
    ghost?.remove();
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
