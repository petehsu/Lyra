import { describe, expect, it, vi } from "vitest";

import { StreamStore } from "./stream-store";

describe("StreamStore", () => {
  it("animation-frame-batches deltas delivered in one IPC flush", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const store = new StreamStore();
    const subscriber = vi.fn();
    store.subscribe("message-1", subscriber);

    store.appendDelta("message-1", "text-1", "hel");
    store.appendDelta("message-1", "text-1", "lo");

    expect(subscriber).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    frames[0]?.(0);
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(store.getBlockText("message-1", "text-1")).toBe("hello");

    vi.unstubAllGlobals();
  });

  it("keeps tool-separated text blocks isolated", () => {
    const store = new StreamStore();
    store.appendDelta("message-1", "text-before-tool", "Before");
    store.appendDelta("message-1", "text-after-tool", "After");
    store.flush();

    expect(store.getBlockText("message-1", "text-before-tool")).toBe("Before");
    expect(store.getBlockText("message-1", "text-after-tool")).toBe("After");
    expect(store.getMessageText("message-1")).toBe("BeforeAfter");
  });

  it("reports only the first delta for each structural text block", () => {
    const store = new StreamStore();

    expect(store.appendDelta("message-1", null, "first")).toBe(true);
    expect(store.appendDelta("message-1", null, " second")).toBe(false);
    expect(store.appendDelta("message-1", "text-2", "after tool")).toBe(true);
    expect(store.appendDelta("message-1", "text-2", " continued")).toBe(false);
  });

  it("lets a synthetic pending UI block follow the newest native text block", () => {
    const store = new StreamStore();
    store.appendDelta("message-1", "text-2", "Live");
    store.flush();

    expect(store.getBlockText("message-1", null)).toBe("Live");

    store.appendDelta("message-1", "text-3", "After tool");
    store.flush();
    expect(store.getBlockText("message-1", null)).toBe("After tool");
  });

  it("merges only new chunks across successive delivery batches", () => {
    const store = new StreamStore();
    store.appendDelta("message-1", "text-1", "first");
    store.flush();
    store.appendDelta("message-1", "text-1", " second");
    store.flush();

    expect(store.getMessageText("message-1")).toBe("first second");
    expect(store.getBlockText("message-1", "text-1")).toBe("first second");
  });

  it("creates and replaces a block when the first event is a replacement", () => {
    const store = new StreamStore();
    store.appendDelta("message-1", "text-1", "stale");
    store.flush();
    store.appendDelta("message-1", "text-1", "fresh", true);
    store.flush();

    expect(store.getBlockText("message-1", "text-1")).toBe("fresh");
    expect(store.blockReplacesFallback("message-1", "text-1")).toBe(true);
    expect(store.getBlockReplacementRevision("message-1", "text-1")).toBe(1);
  });
});
