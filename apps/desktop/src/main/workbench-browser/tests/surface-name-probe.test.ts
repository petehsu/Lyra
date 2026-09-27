import { afterEach, expect, test, vi } from "vitest";
import type { WorkbenchBrowserAgentElement } from "../types";
import { probeUnnamedSurfaceControls } from "../view-manager-runtime/surface-name-probe";

const element = (id: number, extra: Partial<WorkbenchBrowserAgentElement> = {}) => ({
  id, targetRef: `node-${id}`, label: "(no label)", bounds: { x: 10, y: 10, width: 32, height: 32 },
  disabled: false, editable: false, ...extra
} as WorkbenchBrowserAgentElement);

afterEach(() => vi.useRealTimers());

test("restores the pointer after a failed read and never dispatches activation", async () => {
  vi.useFakeTimers();
  const movePointer = vi.fn();
  const execute = vi.fn().mockResolvedValueOnce({ x: 26, y: 26, restore: { x: 700, y: 400 } }).mockRejectedValueOnce(new Error("frame gone"));
  const result = probeUnnamedSurfaceControls([element(1)], { execute, movePointer, assertCanContinue: () => {} });
  await vi.runAllTimersAsync();
  expect(await result).toBe(true);
  expect(movePointer.mock.calls).toEqual([[26, 26], [700, 400]]);
});

test("does not restore or issue further moves after the user takes control", async () => {
  vi.useFakeTimers();
  let takeover = false;
  const movePointer = vi.fn(() => { takeover = true; });
  const result = probeUnnamedSurfaceControls([element(1), element(2)], {
    execute: async () => ({ x: 26, y: 26 }), movePointer,
    assertCanContinue: () => { if (takeover) throw new Error("user takeover"); }
  });
  const assertion = expect(result).rejects.toThrow("user takeover");
  await vi.runAllTimersAsync();
  await assertion;
  expect(movePointer).toHaveBeenCalledTimes(1);
});

test("does not probe named, disabled, hidden, covered, or editable controls", async () => {
  const execute = vi.fn();
  const result = await probeUnnamedSurfaceControls([
    element(1, { label: "Save" }), element(2, { disabled: true }), element(3, { editable: true }),
    element(4, { stateHint: "hover" }), element(5, { visibility: { visible: false, offscreen: true, covered: false, ariaHidden: false } }),
    element(6, { visibility: { visible: true, offscreen: false, covered: true, ariaHidden: false } })
  ], { execute, movePointer: vi.fn(), assertCanContinue: () => {} });
  expect(result).toBe(false);
  expect(execute).not.toHaveBeenCalled();
});

test("bounds automatic probing even on a page full of anonymous controls", async () => {
  vi.useFakeTimers();
  const movePointer = vi.fn();
  const result = probeUnnamedSurfaceControls(Array.from({ length: 40 }, (_, i) => element(i)), {
    execute: async (_element, script) => {
      if (script.includes("return node ? names.finish")) {
        await new Promise(resolve => setTimeout(resolve, 650));
        return "";
      }
      return { x: 26, y: 26 };
    }, movePointer, assertCanContinue: () => {}
  });
  await vi.runAllTimersAsync();
  expect(await result).toBe(true);
  expect(movePointer.mock.calls.length).toBeLessThanOrEqual(7);
  expect(movePointer.mock.calls.at(-1)).toEqual([-1, -1]);
});
