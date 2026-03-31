import { describe, expect, test } from "vitest";

import {
  WORKBENCH_ALLOW_WEB_DRAG_CLASS,
  shouldPreventWorkbenchDragStart
} from "../service";

describe("interaction policy", () => {
  test("prevents drag start by default", () => {
    const target = document.createElement("div");

    expect(shouldPreventWorkbenchDragStart(target)).toBe(true);
  });

  test("allows drag start for explicitly whitelisted regions", () => {
    const host = document.createElement("div");
    const target = document.createElement("span");

    host.className = WORKBENCH_ALLOW_WEB_DRAG_CLASS;
    host.appendChild(target);

    expect(shouldPreventWorkbenchDragStart(target)).toBe(false);
  });
});

