import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { PlanApprovalRequest } from "../../../../shared/desktop-bridge";
import type { AiPlanApprovalWorkspaceOpenRequest } from "../../ai-panel";
import type { WorkspaceTabsModel } from "../../workspace-tabs";
import { useWorkbenchPlanReviewModel } from "../use-workbench-plan-review-model";

const artifact = {
  planId: "plan-1",
  status: "proposed" as const,
  title: "Website plan",
  summary: "Website plan",
  objective: "Build the page",
  assumptions: [],
  steps: [{ id: "step-1", kind: "step", title: "Build", body: "Build the page" }],
  interfaces: [],
  risks: [],
  tests: [],
  acceptanceCriteria: [],
};

const request: PlanApprovalRequest = {
  id: "plan:turn-1",
  sessionId: "thread-1",
  turnId: "turn-1",
  planId: "plan-1",
  version: 2,
  status: "proposed",
  summary: "Website plan",
  artifact,
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
        blockId: "step-1",
        anchor: "Build",
        note: "需要拆成 HTML/CSS/JS 三步",
      });
      await result.current.model.addAnnotation(instanceId, {
        blockId: "step-1",
        anchor: "Build",
        note: "标题换成中文",
      });
    });

    expect(onDecision).not.toHaveBeenCalled();
    expect(result.current.model.getState(instanceId)?.annotations).toHaveLength(2);
    expect(result.current.model.getState(instanceId)?.isActionable).toBe(true);

    const annotations = result.current.model.getState(instanceId)?.annotations ?? [];
    const firstAnnotationId = annotations[0]?.id;
    expect(firstAnnotationId).toBeDefined();

    await act(async () => {
      await result.current.model.updateAnnotation(
        instanceId,
        firstAnnotationId!,
        "需要拆成 HTML/CSS/JS 三个明确阶段"
      );
      await result.current.model.deleteAnnotation(instanceId, annotations[1]!.id);
    });

    expect(result.current.model.getState(instanceId)?.annotations).toHaveLength(1);
    expect(result.current.model.getState(instanceId)?.annotations[0]?.note).toBe(
      "需要拆成 HTML/CSS/JS 三个明确阶段"
    );

    await act(async () => {
      await result.current.model.submitAnnotations(instanceId);
    });

    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "plan-1",
        decision: "keep_planning",
        feedback: expect.stringContaining("需要拆成 HTML/CSS/JS 三个明确阶段"),
      }),
      request
    );
    const submittedResponse = onDecision.mock.calls[0]?.[0] as { readonly feedback?: string } | undefined;
    expect(submittedResponse?.feedback).not.toContain("标题换成中文");
    expect(result.current.model.getState(instanceId)?.isActionable).toBe(false);
  });

  test("updates an existing draft plan review without making it actionable", async () => {
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
        locale: "en-US",
        request: {
          ...request,
          status: "draft",
          artifact: { ...artifact, status: "draft" as const, summary: "First" },
        },
        onDecision,
      });
    });

    const instanceId = openAppTab.mock.calls[0]?.[0]?.appInstanceId as string;
    expect(result.current.model.getState(instanceId)?.isActionable).toBe(false);

    act(() => {
      result.current.openPlanReview({
        locale: "en-US",
        request: {
          ...request,
          status: "draft",
          artifact: { ...artifact, status: "draft" as const, summary: "Second" },
        },
        onDecision,
      });
    });

    expect(openAppTab).toHaveBeenCalledTimes(1);
    expect(result.current.model.getState(instanceId)?.request.artifact.summary).toContain("Second");

    await act(async () => {
      await result.current.model.submitAnnotations(instanceId);
    });

    expect(onDecision).not.toHaveBeenCalled();
  });
});
