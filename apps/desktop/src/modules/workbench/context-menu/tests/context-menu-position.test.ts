import { describe, expect, test } from "vitest";

import {
  clampContextMenuPosition,
  type Rect
} from "../context-menu-position";

describe("context menu position", () => {
  test("keeps menu inside pane boundary", () => {
    const paneBoundary: Rect = {
      left: 0,
      top: 0,
      right: 400,
      bottom: 800
    };

    const position = clampContextMenuPosition({
      anchorX: 360,
      anchorY: 760,
      menuWidth: 180,
      menuHeight: 120,
      paneBoundary
    });

    expect(position.left).toBeLessThanOrEqual(paneBoundary.right - 180 - 6);
    expect(position.top).toBeLessThanOrEqual(paneBoundary.bottom - 120 - 6);
  });

  test("shifts menu away from browser host rect", () => {
    const paneBoundary: Rect = {
      left: 0,
      top: 0,
      right: 1200,
      bottom: 900
    };
    const browserHostRects: Rect[] = [{
      left: 500,
      top: 120,
      right: 1180,
      bottom: 860
    }];

    const position = clampContextMenuPosition({
      anchorX: 220,
      anchorY: 180,
      menuWidth: 188,
      menuHeight: 96,
      paneBoundary,
      browserHostRects
    });

    expect(position.left + 188).toBeLessThanOrEqual(500 - 6);
  });
});