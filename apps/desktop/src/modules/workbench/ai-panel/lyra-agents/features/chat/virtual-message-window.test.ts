import { describe, expect, test } from "vitest";

import {
  MESSAGE_ROW_ESTIMATE_PX,
  messageVirtualizerOptions,
  shouldAdjustMessageScrollOnItemSizeChange
} from "./virtual-message-window";

describe("shouldAdjustMessageScrollOnItemSizeChange", () => {
  test("holds while the content width is changing", () => {
    expect(
      shouldAdjustMessageScrollOnItemSizeChange({
        contentWidthChanging: true,
        userScrolled: true,
        itemIndex: 0,
        rangeStartIndex: 5
      })
    ).toBe(false);
  });

  test("holds while pinned to the bottom", () => {
    expect(
      shouldAdjustMessageScrollOnItemSizeChange({
        contentWidthChanging: false,
        userScrolled: false,
        itemIndex: 0,
        rangeStartIndex: 5
      })
    ).toBe(false);
  });

  test("compensates rows above the rendered range when scrolled away", () => {
    expect(
      shouldAdjustMessageScrollOnItemSizeChange({
        contentWidthChanging: false,
        userScrolled: true,
        itemIndex: 3,
        rangeStartIndex: 5
      })
    ).toBe(true);
  });

  test("does not compensate visible or below rows when scrolled away", () => {
    expect(
      shouldAdjustMessageScrollOnItemSizeChange({
        contentWidthChanging: false,
        userScrolled: true,
        itemIndex: 5,
        rangeStartIndex: 5
      })
    ).toBe(false);
    expect(
      shouldAdjustMessageScrollOnItemSizeChange({
        contentWidthChanging: false,
        userScrolled: true,
        itemIndex: 7,
        rangeStartIndex: 5
      })
    ).toBe(false);
  });

  test("holds before the first range is known", () => {
    expect(
      shouldAdjustMessageScrollOnItemSizeChange({
        contentWidthChanging: false,
        userScrolled: true,
        itemIndex: 0,
        rangeStartIndex: undefined
      })
    ).toBe(false);
  });
});

describe("messageVirtualizerOptions height memory", () => {
  test("estimates from memory and records measured heights by message id", () => {
    const heights = new Map<string, number>([["msg-1", 260]]);
    const recorded: Array<[string, number]> = [];
    const options = messageVirtualizerOptions(
      2,
      () => null,
      (index) => (index === 0 ? "msg-1" : "msg-2"),
      {
        estimateForKey: (key) => heights.get(String(key)) ?? MESSAGE_ROW_ESTIMATE_PX,
        recordHeight: (key, height) => recorded.push([String(key), height])
      }
    );

    expect(options.estimateSize(0)).toBe(260);
    expect(options.estimateSize(1)).toBe(MESSAGE_ROW_ESTIMATE_PX);

    const element = {
      getBoundingClientRect: () => ({ height: 312 }),
      getAttribute: (name: string) => (name === "data-chat-message-id" ? "msg-2" : null)
    } as unknown as HTMLElement;
    expect(options.measureElement(element)).toBe(312);
    expect(recorded).toEqual([["msg-2", 312]]);
  });

  test("falls back to the default estimate without memory", () => {
    const options = messageVirtualizerOptions(
      1,
      () => null,
      (index) => index
    );
    expect(options.estimateSize(0)).toBe(MESSAGE_ROW_ESTIMATE_PX);

    const element = {
      getBoundingClientRect: () => ({ height: 140 }),
      getAttribute: () => null
    } as unknown as HTMLElement;
    expect(options.measureElement(element)).toBe(140);
  });
});
