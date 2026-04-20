import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { AiPanelTopbarActions } from "../topbar-actions";

describe("ai panel topbar actions", () => {
  test("renders actions and dispatches callbacks", () => {
    const onBind = vi.fn();
    const onHistory = vi.fn();
    const onMcp = vi.fn();
    const onSkills = vi.fn();

    render(
      <AiPanelTopbarActions
        onRequestProjectBind={onBind}
        activeBoundProjectName="lyra"
        isBindingProject={false}
        bindProjectLabel="Bind Project"
        isAgentAvailable
        onOpenHistory={onHistory}
        onOpenMcp={onMcp}
        onOpenSkills={onSkills}
        openHistoryLabel="History"
        openMcpLabel="MCP"
        openSkillsLabel="Skills"
      />
    );

    fireEvent.click(screen.getByLabelText("Bind Project"));
    fireEvent.click(screen.getByLabelText("History"));
    fireEvent.click(screen.getByLabelText("MCP"));
    fireEvent.click(screen.getByLabelText("Skills"));

    expect(onBind).toHaveBeenCalledTimes(1);
    expect(onHistory).toHaveBeenCalledTimes(1);
    expect(onMcp).toHaveBeenCalledTimes(1);
    expect(onSkills).toHaveBeenCalledTimes(1);
  });
});
