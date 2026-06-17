import { describe, expect, test, vi } from "vitest";

import { createRafCoalescer } from "../raf-coalesce";

describe("createRafCoalescer", () => {
  test("collapses many schedule() calls in one frame into a single run()", () => {
    const pending: FrameRequestCallback[] = [];
    const raf = (cb: FrameRequestCallback): number => {
      pending.push(cb);
      return pending.length;
    };
    const run = vi.fn();
    const coalescer = createRafCoalescer(run, raf, () => undefined);

    coalescer.schedule();
    coalescer.schedule();
    coalescer.schedule();
    expect(run).not.toHaveBeenCalled();
    expect(pending).toHaveLength(1);

    pending[0]!(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("schedules a fresh frame after the previous one ran", () => {
    const pending: FrameRequestCallback[] = [];
    const raf = (cb: FrameRequestCallback): number => {
      pending.push(cb);
      return pending.length;
    };
    const run = vi.fn();
    const coalescer = createRafCoalescer(run, raf, () => undefined);

    coalescer.schedule();
    pending[0]!(0);
    coalescer.schedule();
    expect(pending).toHaveLength(2);
    pending[1]!(0);
    expect(run).toHaveBeenCalledTimes(2);
  });

  test("cancel() prevents a pending run", () => {
    const pending: FrameRequestCallback[] = [];
    const cancelled: number[] = [];
    const raf = (cb: FrameRequestCallback): number => {
      pending.push(cb);
      return pending.length;
    };
    const run = vi.fn();
    const coalescer = createRafCoalescer(run, raf, (handle) => cancelled.push(handle));

    coalescer.schedule();
    coalescer.cancel();
    expect(cancelled).toEqual([1]);
    // Running a stale callback would be a host bug; the coalescer simply must not
    // have a queued frame anymore, so a subsequent schedule starts a new one.
    coalescer.schedule();
    expect(pending).toHaveLength(2);
  });
});
