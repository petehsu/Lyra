import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

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
  test("renders the theme-adaptive silk background without requiring WebGL", () => {
    const { container } = render(<BrowserSearchSurface {...createProps()} />);

    expect(container.querySelector(".lyra-search-silk-background")).toBeInTheDocument();
    expect(container.querySelector(".lyra-search-silk-canvas-layer")).not.toBeInTheDocument();
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
