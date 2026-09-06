import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResourceChip } from "../ResourceChip";

describe("ResourceChip", () => {
  it("uses native button semantics when interactive", () => {
    const onActivate = vi.fn();
    render(
      <ResourceChip
        ariaLabel="Open report"
        icon={<span aria-hidden="true">F</span>}
        label="report.pdf"
        onActivate={onActivate}
      />
    );

    const chip = screen.getByRole("button", { name: "Open report" });
    expect(chip.tagName).toBe("BUTTON");
    expect(chip).toHaveClass("lyra-agents-inline-resource");
    fireEvent.click(chip);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("uses neutral semantics when no action exists", () => {
    const { container } = render(
      <ResourceChip
        ariaLabel="Attached report"
        icon={<span aria-hidden="true">F</span>}
        label="report.pdf"
      />
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("span.lyra-agents-resource-chip")).not.toBeNull();
  });
});
