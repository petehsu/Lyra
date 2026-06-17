import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  SIDEBAR_COMPOSER_MAX_HEIGHT_PX,
  SIDEBAR_COMPOSER_MIN_HEIGHT_PX,
  useSidebarComposerTextareaHeight
} from "../composer";

describe("useSidebarComposerTextareaHeight", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("applies text-metrics height without DOM content-height reads", () => {
    const textarea = document.createElement("textarea");
    textarea.style.boxSizing = "border-box";
    textarea.style.width = "320px";
    textarea.style.padding = "8px 10px";
    textarea.style.fontSize = "14px";
    textarea.style.lineHeight = "22px";
    document.body.appendChild(textarea);

    const ref = { current: textarea };
    const contentHeightSpy = vi.spyOn(textarea, "scrollHeight", "get");

    renderHook(() => {
      useSidebarComposerTextareaHeight("Hello from sidebar composer.", ref, true);
    });

    expect(contentHeightSpy).not.toHaveBeenCalled();
    const height = Number.parseFloat(textarea.style.height);
    expect(height).toBeGreaterThanOrEqual(SIDEBAR_COMPOSER_MIN_HEIGHT_PX);
    expect(height).toBeLessThanOrEqual(SIDEBAR_COMPOSER_MAX_HEIGHT_PX);

    textarea.remove();
  });

  test("does nothing when disabled", () => {
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    const ref = { current: textarea };

    renderHook(() => {
      useSidebarComposerTextareaHeight("ignored", ref, false);
    });

    expect(textarea.style.height).toBe("");
    textarea.remove();
  });
});