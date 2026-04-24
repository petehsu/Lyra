import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import {
  LinearProgress,
  StatusBadge,
  StatusEmptyState,
  StatusIndicator,
} from "../status-primitives";

describe("status primitives", () => {
  test("renders status indicator variants", () => {
    const { container } = render(
      <div>
        <StatusIndicator tone="info" variant="dot" ariaLabel="dot" />
        <StatusIndicator tone="success" variant="bar" ariaLabel="bar" />
        <StatusIndicator tone="warning" variant="icon" ariaLabel="icon" icon={<span>!</span>} />
      </div>
    );

    expect(container.querySelector(".lyra-ai-status-indicator-dot")).not.toBeNull();
    expect(container.querySelector(".lyra-ai-status-indicator-bar")).not.toBeNull();
    expect(container.querySelector(".lyra-ai-status-indicator-icon")).not.toBeNull();
  });

  test("renders status badge and empty state copy", () => {
    render(
      <div>
        <StatusBadge tone="danger" label="Failed" />
        <StatusEmptyState title="No sessions" description="Start by sending a message." />
      </div>
    );

    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText("No sessions")).toBeDefined();
    expect(screen.getByText("Start by sending a message.")).toBeDefined();
  });

  test("renders linear progress at arbitrary values", () => {
    render(<LinearProgress value={40} maxValue={80} ariaLabel="progress" />);
    const progress = screen.getByRole("progressbar", { name: "progress" });
    expect(progress.getAttribute("aria-valuenow")).toBe("40");
    expect(progress.querySelector(".lyra-ai-linear-progress-fill")).not.toBeNull();
  });
});
