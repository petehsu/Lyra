import { useCallback, useMemo, useRef, useState } from "react";

import {
  createAiPlanReviewAppRequest,
  type AiPlanApprovalWorkspaceOpenRequest,
} from "../ai-panel";
import type {
  AiPlanReviewAnnotation,
  AiPlanReviewModel,
  AiPlanReviewState,
} from "../ai-panel/plan-review-types";
import type { WorkspaceTabsModel } from "../workspace-tabs";

type UseWorkbenchPlanReviewModelParams = {
  readonly openAppTab: WorkspaceTabsModel["openAppTab"];
  readonly title: string;
};

type PlanReviewDecisionHandler = AiPlanApprovalWorkspaceOpenRequest["onDecision"];

const createPlanReviewInstanceId = (requestId: string): string =>
  `ai-plan-review-${requestId.replace(/[^a-z0-9_-]+/giu, "-")}`;

const formatAnnotationFeedback = (
  annotations: readonly AiPlanReviewAnnotation[],
  locale: string
): string => {
  const zh = locale === "zh-CN";
  const heading = zh
    ? "请根据以下计划批注继续规划："
    : "Please revise the plan using these annotations:";
  const lines = annotations.map((annotation, index) => {
    const prefix = `${String(index + 1)}.`;
    if (annotation.kind === "selection") {
      const selectedText = annotation.selectedText?.trim() ?? "";
      return zh
        ? `${prefix} 选中文本「${selectedText}」：${annotation.note}`
        : `${prefix} Selection "${selectedText}": ${annotation.note}`;
    }
    const lineNumber = annotation.lineNumber ?? 0;
    const lineText = annotation.lineText?.trim() ?? "";
    return zh
      ? `${prefix} 第 ${String(lineNumber)} 行「${lineText}」：${annotation.note}`
      : `${prefix} Line ${String(lineNumber)} "${lineText}": ${annotation.note}`;
  });
  return [heading, ...lines].join("\n");
};

export const useWorkbenchPlanReviewModel = ({
  openAppTab,
  title,
}: UseWorkbenchPlanReviewModelParams): {
  readonly model: AiPlanReviewModel;
  readonly openPlanReview: (request: AiPlanApprovalWorkspaceOpenRequest) => void;
} => {
  const handlersRef = useRef<Record<string, PlanReviewDecisionHandler>>({});
  const [statesById, setStatesById] = useState<Record<string, AiPlanReviewState>>({});
  const statesRef = useRef<Record<string, AiPlanReviewState>>({});

  const publishStates = useCallback((next: Record<string, AiPlanReviewState>): void => {
    statesRef.current = next;
    setStatesById(next);
  }, []);

  const patchState = useCallback((
    instanceId: string,
    updater: (state: AiPlanReviewState) => AiPlanReviewState
  ): AiPlanReviewState | null => {
    const current = statesRef.current[instanceId];
    if (current === undefined) {
      return null;
    }
    const nextState = updater(current);
    publishStates({
      ...statesRef.current,
      [instanceId]: nextState,
    });
    return nextState;
  }, [publishStates]);

  const openPlanReview = useCallback((request: AiPlanApprovalWorkspaceOpenRequest): void => {
    const instanceId = createPlanReviewInstanceId(request.request.id);
    const existing = statesRef.current[instanceId];
    handlersRef.current = {
      ...handlersRef.current,
      [instanceId]: request.onDecision,
    };
    publishStates({
      ...statesRef.current,
      [instanceId]: {
        instanceId,
        locale: request.locale,
        request: request.request,
        annotations: existing?.annotations ?? [],
        isActionable: request.request.status === "submitted",
        isSubmitting: false,
        lastSubmittedAt: existing?.lastSubmittedAt ?? null,
      },
    });
    if (existing === undefined || request.request.status === "submitted") {
      openAppTab(createAiPlanReviewAppRequest(title, instanceId));
    }
  }, [openAppTab, publishStates, title]);

  const getState = useCallback(
    (instanceId: string): AiPlanReviewState | null =>
      statesRef.current[instanceId] ?? statesById[instanceId] ?? null,
    [statesById]
  );

  const decide = useCallback<AiPlanReviewModel["decide"]>(async (instanceId, response) => {
    const state = statesRef.current[instanceId];
    const handler = handlersRef.current[instanceId];
    if (state === undefined || handler === undefined) {
      return;
    }
    patchState(instanceId, (current) => ({ ...current, isSubmitting: true }));
    try {
      await handler(response, state.request);
      patchState(instanceId, (current) => ({
        ...current,
        isActionable: false,
        isSubmitting: false,
        lastSubmittedAt: Date.now(),
      }));
    } catch (error) {
      patchState(instanceId, (current) => ({ ...current, isSubmitting: false }));
      throw error;
    }
  }, [patchState]);

  const addAnnotation = useCallback<AiPlanReviewModel["addAnnotation"]>(async (
    instanceId,
    annotation
  ) => {
    const state = statesRef.current[instanceId];
    if (state === undefined) {
      return;
    }
    const nextAnnotation: AiPlanReviewAnnotation = {
      ...annotation,
      id: `plan-annotation-${String(Date.now())}-${String(state.annotations.length + 1)}`,
      createdAt: Date.now(),
    };
    const nextAnnotations = [...state.annotations, nextAnnotation];
    publishStates({
      ...statesRef.current,
      [instanceId]: {
        ...state,
        annotations: nextAnnotations,
      },
    });
  }, [publishStates]);

  const updateAnnotation = useCallback<AiPlanReviewModel["updateAnnotation"]>(async (
    instanceId,
    annotationId,
    note
  ) => {
    const trimmed = note.trim();
    if (trimmed.length === 0) {
      return;
    }
    patchState(instanceId, (state) => ({
      ...state,
      annotations: state.annotations.map((annotation) =>
        annotation.id === annotationId
          ? { ...annotation, note: trimmed }
          : annotation
      ),
    }));
  }, [patchState]);

  const deleteAnnotation = useCallback<AiPlanReviewModel["deleteAnnotation"]>(async (
    instanceId,
    annotationId
  ) => {
    patchState(instanceId, (state) => ({
      ...state,
      annotations: state.annotations.filter((annotation) => annotation.id !== annotationId),
    }));
  }, [patchState]);

  const submitAnnotations = useCallback<AiPlanReviewModel["submitAnnotations"]>(async (instanceId) => {
    const state = statesRef.current[instanceId];
    if (state === undefined || state.annotations.length === 0 || !state.isActionable) {
      return;
    }
    await decide(instanceId, {
      requestId: state.request.id,
      decision: "keep_planning",
      feedback: formatAnnotationFeedback(state.annotations, state.locale),
    });
  }, [decide]);

  const model = useMemo<AiPlanReviewModel>(
    () => ({
      getState,
      decide,
      addAnnotation,
      updateAnnotation,
      deleteAnnotation,
      submitAnnotations,
    }),
    [addAnnotation, decide, deleteAnnotation, getState, submitAnnotations, updateAnnotation]
  );

  return {
    model,
    openPlanReview,
  };
};
