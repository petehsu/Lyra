// 自检: BufferDirtyTracker 脏行追踪逻辑

import { describe, it, expect } from "vitest";
import { createBufferDirtyTracker } from "../buffer-dirty-tracker";

describe("BufferDirtyTracker", () => {
  it("初始状态 fullyDirty=true", () => {
    const tracker = createBufferDirtyTracker();
    expect(tracker.isFullyDirty()).toBe(true);
    expect(tracker.consumeDirtyRanges()).toEqual([]);
  });

  it("markAllDirty 重置为 fullyDirty", () => {
    const tracker = createBufferDirtyTracker();
    tracker.clear();
    expect(tracker.isFullyDirty()).toBe(false);

    tracker.markAllDirty();
    expect(tracker.isFullyDirty()).toBe(true);
  });

  it("markDirty 添加 range，consumeDirtyRanges 消费后清空", () => {
    const tracker = createBufferDirtyTracker();
    tracker.clear();

    tracker.markDirty(5, 10);
    tracker.markDirty(20, 25);

    const ranges = tracker.consumeDirtyRanges();
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual({ startLine: 5, endLine: 10 });
    expect(ranges[1]).toEqual({ startLine: 20, endLine: 25 });

    // 消费后清空
    expect(tracker.consumeDirtyRanges()).toEqual([]);
  });

  it("range 数量超过阈值时切换到 fullyDirty", () => {
    const tracker = createBufferDirtyTracker();
    tracker.clear();

    // 超过 64 个 range → 切换 fullyDirty
    for (let i = 0; i < 70; i++) {
      tracker.markDirty(i, i);
    }

    expect(tracker.isFullyDirty()).toBe(true);
  });
});