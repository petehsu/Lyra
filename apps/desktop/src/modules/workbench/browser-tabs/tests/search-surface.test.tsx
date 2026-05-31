import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { BrowserSearchSurface, type BrowserSearchSurfaceProps } from "../search-surface";

const createProps = (
  overrides: Partial<BrowserSearchSurfaceProps> = {}
): BrowserSearchSurfaceProps => ({
  logoUrl: "/logo.svg",
  inputValue: "",
  placeholder: "Search or enter address",
  searchActionLabel: "Search",
  deepSearchToggleLabel: "Search mode",
  deepSearchEnabled: false,
  deepSearchChipLabel: "Deep",
  onInputChange: vi.fn(),
  onSubmit: vi.fn(),
  onToggleDeepSearch: vi.fn(),
  ...overrides
});

describe("BrowserSearchSurface", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test("renders the theme-adaptive silk background without requiring WebGL", () => {
    const { container } = render(<BrowserSearchSurface {...createProps()} />);

    expect(container.querySelector(".lyra-search-silk-background")).toBeInTheDocument();
    expect(container.querySelector(".lyra-search-silk-canvas-layer")).not.toBeInTheDocument();
  });

  test("keeps the silk canvas mounted while animation is available", () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((contextId) => {
      if (
        contextId === "webgl2"
        || contextId === "webgl"
        || contextId === "experimental-webgl"
      ) {
        return {
          getExtension: () => ({
            loseContext: vi.fn()
          })
        } as unknown as RenderingContext;
      }
      return null;
    });

    const { container } = render(<BrowserSearchSurface {...createProps()} />);

    expect(container.querySelector(".lyra-search-silk-canvas-layer")).toBeInTheDocument();
    const canvasLayer = container.querySelector(".lyra-search-silk-canvas-layer");

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(container.querySelector(".lyra-search-silk-canvas-layer")).toBe(canvasLayer);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "l" }));
    });

    expect(container.querySelector(".lyra-search-silk-canvas-layer")).toBe(canvasLayer);
  });

  test("keeps the search controls interactive above the background", () => {
    const onInputChange = vi.fn();
    const onSubmit = vi.fn();

    render(<BrowserSearchSurface {...createProps({ onInputChange, onSubmit })} />);

    fireEvent.change(screen.getByLabelText("browser-address-input"), {
      target: { value: "lyra search" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(onInputChange).toHaveBeenCalledWith("lyra search");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
