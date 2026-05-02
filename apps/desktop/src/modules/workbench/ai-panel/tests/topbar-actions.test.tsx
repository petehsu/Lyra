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
        activeBoundProjectName="/Users/dev/lyra"
        isBindingProject={false}
        bindProjectLabel="Bind Project"
        isAgentAvailable
        onOpenHistory={onHistory}
        onOpenMcp={onMcp}
        onOpenSkills={onSkills}
        openHistoryLabel="History"
        openMcpLabel="MCP"
        openSkillsLabel="Skills"
        moreActionsLabel="More"
      />
    );

    expect(screen.getByText("lyra")).toBeDefined();
    fireEvent.click(screen.getByLabelText("Bind Project"));
    fireEvent.click(screen.getByLabelText("History"));
    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(screen.getByRole("menuitem", { name: "MCP" }));
    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Skills" }));

    expect(onBind).toHaveBeenCalledTimes(1);
    expect(onHistory).toHaveBeenCalledTimes(1);
    expect(onMcp).toHaveBeenCalledTimes(1);
    expect(onSkills).toHaveBeenCalledTimes(1);
  });

  test("exposes review from the more menu", () => {
    const onReview = vi.fn();

    render(
      <AiPanelTopbarActions
        activeBoundProjectName={null}
        isBindingProject={false}
        bindProjectLabel="Bind Project"
        isAgentAvailable
        onStartReview={onReview}
        reviewChangesLabel="Review changes"
        moreActionsLabel="More"
      />
    );

    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Review changes" }));

    expect(onReview).toHaveBeenCalledTimes(1);
  });

  test("exposes advanced tools from the more menu", () => {
    const onAdvanced = vi.fn();

    render(
      <AiPanelTopbarActions
        activeBoundProjectName={null}
        isBindingProject={false}
        bindProjectLabel="Bind Project"
        isAgentAvailable
        onOpenAdvancedTools={onAdvanced}
        advancedToolsLabel="Advanced tools"
        moreActionsLabel="More"
      />
    );

    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Advanced tools" }));

    expect(onAdvanced).toHaveBeenCalledTimes(1);
  });

  test("omits review when no usable review action is provided", () => {
    render(
      <AiPanelTopbarActions
        activeBoundProjectName={null}
        isBindingProject={false}
        bindProjectLabel="Bind Project"
        isAgentAvailable
        onOpenMcp={() => undefined}
        openMcpLabel="MCP"
        reviewChangesLabel="Review changes"
        moreActionsLabel="More"
      />
    );

    fireEvent.click(screen.getByLabelText("More"));

    expect(screen.queryByRole("menuitem", { name: "Review changes" })).toBeNull();
  });

  test("toggles sidebar placement from the more menu", () => {
    const onToggleSide = vi.fn();

    const { rerender } = render(
      <AiPanelTopbarActions
        activeBoundProjectName={null}
        isBindingProject={false}
        bindProjectLabel="Bind Project"
        isAgentAvailable
        aiPanelSide="left"
        onToggleAiPanelSide={onToggleSide}
        movePanelToLeftLabel="Move left"
        movePanelToRightLabel="Move right"
        moreActionsLabel="More"
      />
    );

    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move right" }));

    expect(onToggleSide).toHaveBeenCalledTimes(1);

    rerender(
      <AiPanelTopbarActions
        activeBoundProjectName={null}
        isBindingProject={false}
        bindProjectLabel="Bind Project"
        isAgentAvailable
        aiPanelSide="right"
        onToggleAiPanelSide={onToggleSide}
        movePanelToLeftLabel="Move left"
        movePanelToRightLabel="Move right"
        moreActionsLabel="More"
      />
    );

    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move left" }));

    expect(onToggleSide).toHaveBeenCalledTimes(2);
  });
});
