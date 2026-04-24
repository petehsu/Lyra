import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { SpinnerLabel, StreamSpinner } from "../stream-spinner";

const DOTS_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SAND_FRAMES = ["⠁", "⠂", "⠄", "⡀", "⡈"];

describe("stream spinner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("StreamSpinner wraps the dots spinner with status semantics", () => {
    const { container } = render(<StreamSpinner ariaLabel="thinking" />);
    const host = container.querySelector(".lyra-ai-spinner-label") as HTMLElement | null;
    const glyph = container.querySelector(".lyra-ai-stream-spinner") as HTMLElement | null;

    expect(host).not.toBeNull();
    expect(glyph).not.toBeNull();
    expect(host?.getAttribute("role")).toBe("status");
    expect(host?.getAttribute("aria-label")).toBe("thinking");
    expect(glyph?.textContent).toBe(DOTS_FRAMES[0]);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(glyph?.textContent).toBe(DOTS_FRAMES[1]);
  });

  test("SpinnerLabel supports the sand variant and visible labels", () => {
    const { container } = render(
      <SpinnerLabel
        ariaLabel="waiting"
        label="Waiting"
        variant="sand"
        tone="warning"
        size="sm"
      />
    );
    const host = container.querySelector(".lyra-ai-spinner-label") as HTMLElement | null;
    const glyph = container.querySelector(".lyra-ai-stream-spinner") as HTMLElement | null;

    expect(host?.className).toContain("lyra-ai-spinner-label-sm");
    expect(host?.className).toContain("lyra-ai-spinner-label-tone-warning");
    expect(glyph?.textContent).toBe(SAND_FRAMES[0]);
    expect(screen.getByText("Waiting")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(60);
    });

    expect(glyph?.textContent).toBe(SAND_FRAMES[1]);
  });

  test("omits aria-label when none is provided", () => {
    const { container } = render(<StreamSpinner />);
    const host = container.querySelector(".lyra-ai-spinner-label") as HTMLElement | null;
    expect(host).not.toBeNull();
    expect(host?.hasAttribute("aria-label")).toBe(false);
    expect(host?.getAttribute("role")).toBe("status");
  });
});
