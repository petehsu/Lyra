import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { AiPanelThreadView } from "../thread-view";
import { PlanCard } from "../plan-card";
import { AiPanelPlanRow } from "../thread-rows";
import {
  buildAiPanelThreadMessageMetadata,
  buildAiPanelThreadRenderRows,
} from "../thread-render-model";
import type { LyraTurnPlanState } from "../use-lyra-thread-runtime";
import type { DisplayMessage } from "../view-helpers";

const messages: DisplayMessage[] = Array.from({ length: 1000 }, (_, index) => ({
  id: `assistant-${index}`,
  sessionId: "thread-1",
  turnId: `turn-${index}`,
  role: "assistant",
  content: `Reply ${index}`,
  displayContent: `Reply ${index}`,
  createdAt: 1000 + index,
}));

const turnsById = new Map(messages.map((message, index) => [
  `turn-${index}`,
  {
    id: `turn-${index}`,
    sessionId: "thread-1",
    profileId: "lp-openai",
    status: "completed" as const,
    createdAt: 1000 + index,
    updatedAt: 1000 + index,
  },
]));

describe("AiPanelThreadView virtualization", () => {
  test("renders only the visible overscan slice for long threads", () => {
    const messageMetadata = buildAiPanelThreadMessageMetadata(messages);
    const renderRows = buildAiPanelThreadRenderRows({
      sortedMessages: messages,
      planByTurn: {},
      typewriterText: "",
      streamingTurnRuntimeFeed: [],
      streamingStatus: null,
      orphanRuntimeFeed: [],
      runtimeError: null,
      messageMetadata,
    });
    const virtualRows = renderRows.slice(0, 12).map((row, index) => ({
      row,
      index,
      top: index * 156,
    }));

    const { container } = render(
      <AiPanelThreadView
        logoUrl=""
        locale="en-US"
        isZhLocale={false}
        title="Thread"
        richRenderingEnabled={false}
        showEmptySessionScene={false}
        isLoading={false}
        loadingSessionLabel="Loading"
        emptyThreadLabel="Empty"
        threadRef={createRef<HTMLDivElement>()}
        threadStyle={{ height: 240 }}
        messageMetadata={messageMetadata}
        virtualRows={virtualRows}
        topSpacerHeight={0}
        bottomSpacerHeight={(renderRows.length - virtualRows.length) * 156}
        measureRow={vi.fn()}
        turnsById={turnsById}
        runtimeFeedByTurn={new Map()}
        turnTimelineByTurn={new Map()}
        assistantMessageOrderById={new Map(messages.map((message, index) => [message.id, index + 1]))}
        turnWorkingLabel="Working"
        turnWorkedForPrefix="Worked for"
        toolStatusRunningLabel="Running"
        toolStatusCompletedLabel="Completed"
        toolStatusFailedLabel="Failed"
        pendingInteractionQueue={[]}
        canOpenFilePath={false}
        openRuntimeTargetPath={vi.fn(async () => {})}
        typewriterText=""
        streamingTurnRuntimeFeed={[]}
        streamingStatus={null}
        orphanRuntimeFeed={[]}
        latestPlanTurnId={null}
        planActionsEnabled={false}
        copyMessageLabel="Copy"
        copiedMessageLabel="Copied"
        forkResponseLabel="Fork"
        regenerateResponseLabel="Regenerate"
        editMessageLabel="Edit"
        onForkTurn={vi.fn()}
        onRegenerateTurn={vi.fn()}
        onEditMessageTurn={vi.fn()}
        onPlanApprovalDecision={vi.fn(async () => {})}
        onOpenPlanApprovalInPanel={vi.fn()}
      />
    );

    expect(screen.getByText("Reply 0")).toBeDefined();
    expect(screen.queryByText("Reply 999")).toBeNull();
    expect(container.querySelectorAll(".lyra-ai-agent-thread-row").length).toBeLessThan(40);
  });
});

describe("AiPanelThreadRenderRows plans", () => {
  test("does not render update_plan checklists as Plan Mode plan cards", () => {
    const messageMetadata = buildAiPanelThreadMessageMetadata(messages.slice(0, 1));
    const checklistOnlyPlan: LyraTurnPlanState = {
      turnId: "turn-0",
      draftText: "",
      finalText: null,
      explanation: "tracking",
      steps: [{ step: "inspect", status: "completed" }],
      updatedAt: 2000,
    };

    const renderRows = buildAiPanelThreadRenderRows({
      sortedMessages: messages.slice(0, 1),
      planByTurn: { "turn-0": checklistOnlyPlan },
      typewriterText: "",
      streamingTurnRuntimeFeed: [],
      streamingStatus: null,
      orphanRuntimeFeed: [],
      runtimeError: null,
      messageMetadata,
    });

    expect(renderRows.some((row) => row.kind === "plan")).toBe(false);
  });
});

describe("PlanCard", () => {
  test("labels submitted plans separately from drafts", () => {
    const submittedPlan: LyraTurnPlanState = {
      turnId: "turn-plan",
      draftText: "- draft",
      finalText: "- final",
      explanation: null,
      steps: [],
      updatedAt: 2000,
    };

    const { container } = render(
      <PlanCard
        locale="zh-CN"
        plan={submittedPlan}
        richRenderingEnabled={false}
        showActions={false}
        onReject={vi.fn()}
      />
    );

    expect(container.querySelector(".lyra-ai-plan-card")?.getAttribute("aria-label")).toBe("已提交计划");
    expect(screen.getByText("已提交计划")).toBeDefined();
    expect(screen.queryByText("计划草案")).toBeNull();
    expect(container.querySelector(".lyra-ai-status-badge")).toBeNull();
  });

  test("renders full plan text before approval even when checklist steps exist", () => {
    const submittedPlan: LyraTurnPlanState = {
      turnId: "turn-plan",
      draftText: "- draft",
      finalText: "# Final plan\n\n- Inspect\n- Patch",
      explanation: "tracking",
      steps: [{ step: "Inspect", status: "pending" }],
      updatedAt: 2000,
    };

    render(
      <PlanCard
        locale="en-US"
        plan={submittedPlan}
        richRenderingEnabled={false}
        showActions={false}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText(/Final plan/)).toBeDefined();
    expect(screen.getByText("Inspect")).toBeDefined();
  });
});

describe("AiPanelPlanRow", () => {
  test("renders approval actions on the plan card when pending approval", () => {
    const submittedPlan: LyraTurnPlanState = {
      turnId: "turn-plan",
      draftText: "- draft",
      finalText: "# Final plan",
      explanation: null,
      steps: [],
      updatedAt: 2000,
    };
    const onPlanApprovalDecision = vi.fn(async () => {});

    render(
      <AiPanelPlanRow
        row={{
          kind: "plan",
          key: "plan:turn-plan",
          plan: submittedPlan,
          sessionId: "thread-1",
        }}
        locale="en-US"
        richRenderingEnabled={false}
        latestPlanTurnId="turn-plan"
        planActionsEnabled={true}
        pendingInteractionQueue={[{
          kind: "planApproval",
          request: {
            id: "plan:turn-plan",
            sessionId: "thread-1",
            turnId: "turn-plan",
            version: 0,
            status: "submitted",
            summary: "Final plan",
            proposedMarkdown: "# Final plan",
          },
        }]}
        onPlanApprovalDecision={onPlanApprovalDecision}
        onOpenPlanApprovalInWorkspace={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve and Implement" }));

    expect(onPlanApprovalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "plan:turn-plan",
        decision: "approve_and_implement",
      }),
      expect.objectContaining({ id: "plan:turn-plan" })
    );
    expect(screen.getByRole("button", { name: "Keep Planning" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Open in Workspace" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDefined();
  });

  test("hides plan approval actions when the plan is not pending approval", () => {
    const submittedPlan: LyraTurnPlanState = {
      turnId: "turn-plan",
      draftText: "- draft",
      finalText: "# Final plan",
      explanation: null,
      steps: [],
      updatedAt: 2000,
    };

    render(
      <AiPanelPlanRow
        row={{
          kind: "plan",
          key: "plan:turn-plan",
          plan: submittedPlan,
          sessionId: "thread-1",
        }}
        locale="en-US"
        richRenderingEnabled={false}
        latestPlanTurnId="turn-plan"
        planActionsEnabled={true}
        pendingInteractionQueue={[]}
        onPlanApprovalDecision={vi.fn(async () => {})}
        onOpenPlanApprovalInWorkspace={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "Open in Workspace" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });
});
