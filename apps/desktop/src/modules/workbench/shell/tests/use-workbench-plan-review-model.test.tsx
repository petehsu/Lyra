import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { PlanApprovalRequest } from "../../../../shared/desktop-bridge";
import type { AiPlanApprovalWorkspaceOpenRequest } from "../../ai-panel";
import type { WorkspaceTabsModel } from "../../workspace-tabs";
import { useWorkbenchPlanReviewModel } from "../use-workbench-plan-review-model";

const request: PlanApprovalRequest = {
  id: "plan:turn-1",
  sessionId: "thread-1",
  turnId: "turn-1",
  version: 0,
  status: "submitted",
  summary: "Website plan",
  proposedMarkdown: "# Website plan\n\n- Build the page",
};

describe("useWorkbenchPlanReviewModel", () => {
  test("stores multiple annotations locally before submitting them as keep-planning feedback", async () => {
    const openAppTab = vi.fn();
    const onDecision = vi.fn<AiPlanApprovalWorkspaceOpenRequest["onDecision"]>(async () => {});
    const { result } = renderHook(() =>
      useWorkbenchPlanReviewModel({
        openAppTab: openAppTab as unknown as WorkspaceTabsModel["openAppTab"],
        title: "Plan Review",
      })
    );

    act(() => {
      result.current.openPlanReview({
        locale: "zh-CN",
        request,
        onDecision,
      });
    });

    const instanceId = openAppTab.mock.calls[0]?.[0]?.appInstanceId as string;

    await act(async () => {
      await result.current.model.addAnnotation(instanceId, {
        kind: "line",
        lineNumber: 2,
        lineText: "- Build the page",
        note: "需要拆成 HTML/CSS/JS 三步",
      });
      await result.current.model.addAnnotation(instanceId, {
        kind: "selection",
        selectedText: "Website plan",
        note: "标题换成中文",
      });
    });

    expect(onDecision).not.toHaveBeenCalled();
    expect(result.current.model.getState(instanceId)?.annotations).toHaveLength(2);
    expect(result.current.model.getState(instanceId)?.isActionable).toBe(true);

    await act(async () => {
      await result.current.model.submitAnnotations(instanceId);
    });

    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "plan:turn-1",
        decision: "keep_planning",
        feedback: expect.stringContaining("需要拆成 HTML/CSS/JS 三步"),
      }),
      request
    );
    const submittedResponse = onDecision.mock.calls[0]?.[0] as { readonly feedback?: string } | undefined;
    expect(submittedResponse?.feedback).toContain("标题换成中文");
    expect(result.current.model.getState(instanceId)?.isActionable).toBe(false);
  });
});
