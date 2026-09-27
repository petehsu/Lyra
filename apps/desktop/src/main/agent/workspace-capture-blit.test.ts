import { describe, expect, test } from "vitest";

import { paintWorkspaceLayers } from "./workspace-capture-blit";

describe("paintWorkspaceLayers", () => {
  test("paints a page bitmap onto the shell at css coordinates", () => {
    const shell = Buffer.alloc(8, 0);
    const page = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const painted = paintWorkspaceLayers(shell, 2, 1, 2, 1, [{
      x: 1,
      y: 0,
      width: 1,
      height: 1,
      bitmap: page,
      bitmapWidth: 2,
      bitmapHeight: 1
    }]);
    expect([...painted.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...painted.subarray(4, 8)]).toEqual([1, 2, 3, 4]);
  });
});
