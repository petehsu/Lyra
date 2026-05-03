import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

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

const turnsById = new Map(messages.map((_, index) => [
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

const planArtifact = (
  status: "draft" | "proposed" = "proposed",
  title = "Final plan"
) => ({
  planId: "plan-1",
  status,
  title,
  summary: "Plan summary",
  objective: "Implement the plan.",
  assumptions: [],
  steps: [{ id: "step-1", kind: "step", title: "Inspect", body: "Inspect the app." }],
  interfaces: [],
  risks: [],
  tests: [],
  acceptanceCriteria: [],
});

const planState = (
  status: "draft" | "proposed" = "proposed",
  title = "Final plan"
): LyraTurnPlanState => ({
  turnId: "turn-plan",
  artifact: planArtifact(status, title),
  updatedAt: 2000,
});

afterEach(() => {
  cleanup();
});

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
        aiToolDisplayMode="inner_scroll"
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
        showFullOutputLabel="Show full output"
        expandToolOutputLabel="Expand output"
        collapseToolOutputLabel="Collapse output"
        fileChangesLabel="File changes"
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

    const renderRows = buildAiPanelThreadRenderRows({
      sortedMessages: messages.slice(0, 1),
      planByTurn: {},
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
  test("labels proposed plans separately from drafts", () => {
    const proposedPlan = planState("proposed", "Final plan");

    const { container } = render(
      <PlanCard
        locale="zh-CN"
        plan={proposedPlan}
        richRenderingEnabled={false}
        showActions={false}
        onReject={vi.fn()}
      />
    );

    expect(container.querySelector(".lyra-ai-plan-card")?.getAttribute("aria-label")).toBe("待审批计划");
    expect(screen.getByText("待审批计划")).toBeDefined();
    expect(screen.getByText("步骤")).toBeDefined();
    expect(screen.queryByText("计划草案")).toBeNull();
    expect(container.querySelector(".lyra-ai-status-badge")).toBeNull();
  });

  test("renders full plan text before approval even when checklist steps exist", () => {
    const proposedPlan = planState("proposed", "Final plan");

    render(
      <PlanCard
        locale="en-US"
        plan={proposedPlan}
        richRenderingEnabled={false}
        showActions={false}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText("Final plan")).toBeDefined();
    expect(screen.getByText("Inspect")).toBeDefined();
  });
});

describe("AiPanelPlanRow", () => {
  test("renders approval actions on the plan card when pending approval", () => {
    const proposedPlan = planState("proposed", "Final plan");
    const onPlanApprovalDecision = vi.fn(async () => {});

    render(
      <AiPanelPlanRow
        row={{
          kind: "plan",
          key: "plan:turn-plan",
          plan: proposedPlan,
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
            planId: "plan-1",
            version: 2,
            status: "proposed",
            summary: "Final plan",
            artifact: proposedPlan.artifact,
          },
        }]}
        onPlanApprovalDecision={onPlanApprovalDecision}
        onOpenPlanApprovalInWorkspace={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve and Implement" }));

    expect(onPlanApprovalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "plan-1",
        decision: "approve_and_implement",
      }),
      expect.objectContaining({ id: "plan:turn-plan" })
    );
    expect(screen.getByRole("button", { name: "Keep Planning" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Open in Workspace" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDefined();
  });

  test("hides plan approval actions when the plan is not pending approval", () => {
    const proposedPlan = planState("proposed", "Final plan");

    render(
      <AiPanelPlanRow
        row={{
          kind: "plan",
          key: "plan:turn-plan",
          plan: proposedPlan,
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
