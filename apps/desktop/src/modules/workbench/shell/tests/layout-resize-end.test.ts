import { describe, expect, test, vi } from "vitest";

import {
  notifyLayoutResizeEnd,
  subscribeLayoutResizeEnd
} from "../layout-resize-end";

describe("layout-resize-end", () => {
  test("notifies subscribers once per drag end", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeLayoutResizeEnd(first);
    subscribeLayoutResizeEnd(second);

    notifyLayoutResizeEnd();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    notifyLayoutResizeEnd();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });
});