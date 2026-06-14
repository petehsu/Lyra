import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createBackpressuredEventSender,
  readBackpressureMetrics
} from "./backpressure";

describe("backpressured event sender", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("coalesces keyed events inside one throttle window", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const sender = createBackpressuredEventSender<{
      readonly id: string;
      readonly value: number;
    }>({
      name: "test.coalesce",
      intervalMs: 50,
      maxQueueSize: 8,
      leading: false,
      keyFor: (event) => event.id,
      merge: (_current, incoming) => incoming,
      send
    });

    sender.enqueue({ id: "a", value: 1 });
    sender.enqueue({ id: "a", value: 2 });
    sender.enqueue({ id: "b", value: 3 });

    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, { id: "a", value: 2 });
    expect(send).toHaveBeenNthCalledWith(2, { id: "b", value: 3 });
    expect(sender.metrics()).toMatchObject({
      receivedEvents: 3,
      sentEvents: 2,
      coalescedEvents: 1,
      flushCount: 1
    });

    sender.dispose();
  });

  test("keeps a leading send but throttles following events", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const sender = createBackpressuredEventSender<number>({
      name: "test.leading",
      intervalMs: 50,
      maxQueueSize: 8,
      send
    });

    sender.enqueue(1);
    sender.enqueue(2);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(1);

    vi.advanceTimersByTime(49);
    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(2);

    sender.dispose();
  });

  test("flushes when the queue reaches its maximum size", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const sender = createBackpressuredEventSender<number>({
      name: "test.maxQueue",
      intervalMs: 100,
      maxQueueSize: 2,
      leading: false,
      send
    });

    sender.enqueue(1);
    sender.enqueue(2);
    sender.enqueue(3);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, 1);
    expect(send).toHaveBeenNthCalledWith(2, 2);
    expect(sender.metrics()).toMatchObject({
      forcedFlushes: 1,
      sentEvents: 2
    });

    sender.dispose();
  });

  test("keeps non-consecutive matching keys separate when requested", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const sender = createBackpressuredEventSender<{
      readonly id: string;
      readonly text: string;
    }>({
      name: "test.consecutive",
      intervalMs: 50,
      maxQueueSize: 8,
      leading: false,
      coalesceMode: "consecutive",
      keyFor: (event) => event.id,
      merge: (current, incoming) => ({
        ...current,
        text: `${current.text}${incoming.text}`
      }),
      send
    });

    sender.enqueue({ id: "a", text: "1" });
    sender.enqueue({ id: "b", text: "2" });
    sender.enqueue({ id: "a", text: "3" });
    sender.enqueue({ id: "a", text: "4" });

    vi.advanceTimersByTime(50);

    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenNthCalledWith(1, { id: "a", text: "1" });
    expect(send).toHaveBeenNthCalledWith(2, { id: "b", text: "2" });
    expect(send).toHaveBeenNthCalledWith(3, { id: "a", text: "34" });
    expect(sender.metrics().coalescedEvents).toBe(1);

    sender.dispose();
  });

  test("registers and unregisters metrics readers", () => {
    const sender = createBackpressuredEventSender<number>({
      name: "test.metrics",
      intervalMs: 50,
      maxQueueSize: 8,
      send: vi.fn()
    });

    expect(readBackpressureMetrics().some((metric) => metric.name === "test.metrics")).toBe(true);

    sender.dispose();

    expect(readBackpressureMetrics().some((metric) => metric.name === "test.metrics")).toBe(false);
  });
});
