import { useCallback, useRef, useState } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type {
  AgentPlanPhase,
  AgentPlanReviewStatus,
  AgentPlanSnapshot,
  AgentProjectPlanReadResponse
} from "../../../shared/agent";
import type { WorkspaceAppTabMetaRequest, WorkspaceAppTabOpenRequest } from "../workspace-tabs";
import type {
  AgentPlanBoardAppState,
  AgentPlanBoardModel
} from "./types";

export const AGENT_PLAN_BOARD_APP_ID = "agent-plan-board" as const;
export const AGENT_PLAN_BOARD_ICON_KEY = "agent-plan-board-default" as const;

const normalizeInstanceToken = (value: string): string => {
  const token = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return token.length > 0 ? token : "unbound";
};

export const createAgentPlanBoardInstanceId = (agentSessionId: string): string =>
  `agent-plan-board-${normalizeInstanceToken(agentSessionId)}`;

export const createAgentPlanBoardManagerInstanceId = (
  agentSessionId: string,
  workingDir: string
): string =>
  `agent-plan-board-manager-${normalizeInstanceToken(`${agentSessionId}-${workingDir}`)}`;

export const createAgentPlanBoardAppRequest = (
  agentSessionId: string,
  title: string
): WorkspaceAppTabOpenRequest => ({
  appId: AGENT_PLAN_BOARD_APP_ID,
  appInstanceId: createAgentPlanBoardInstanceId(agentSessionId),
  title,
  iconKey: AGENT_PLAN_BOARD_ICON_KEY,
  fileSessionId: agentSessionId
});

export const createAgentPlanBoardManagerAppRequest = (
  agentSessionId: string,
  workingDir: string,
  title: string
): WorkspaceAppTabOpenRequest => ({
  appId: AGENT_PLAN_BOARD_APP_ID,
  appInstanceId: createAgentPlanBoardManagerInstanceId(agentSessionId, workingDir),
  title,
  iconKey: AGENT_PLAN_BOARD_ICON_KEY,
  fileSessionId: agentSessionId
});

type UseAgentPlanBoardModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly onMetaChange: (request: WorkspaceAppTabMetaRequest) => void;
};

const PLAN_PHASES = new Set<string>([
  "none",
  "planning",
  "reviewing",
  "todo_required",
  "executing_todo",
  "completed",
  "rejected"
]);

const normalizePlanPhase = (value: string | null | undefined): AgentPlanPhase =>
  PLAN_PHASES.has(value ?? "") ? value as AgentPlanPhase : "none";

const reviewStatusForPhase = (phase: AgentPlanPhase): AgentPlanReviewStatus => {
  if (phase === "reviewing") return "pending";
  if (phase === "rejected") return "rejected";
  if (phase === "todo_required" || phase === "executing_todo" || phase === "completed") {
    return "approved";
  }
  return "none";
};

const planSnapshotFromProjectRead = (
  response: AgentProjectPlanReadResponse
): AgentPlanSnapshot => {
  const phase = normalizePlanPhase(response.plan.status);
  const currentVersion = response.currentVersion;
  const versionId =
    currentVersion?.versionId
    ?? response.plan.currentVersionId
    ?? response.plan.planId;
  return {
    activePlanId: response.plan.planId,
    activeVersionId: versionId,
    projectKey: response.projectKey,
    title: response.plan.title,
    phase,
    markdown: currentVersion?.markdown ?? "",
    annotations: currentVersion?.annotations ?? [],
    review: {
      status: reviewStatusForPhase(phase),
      summary: null
    },
    reason: null,
    scope: response.workingDir
  };
};

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const useAgentPlanBoardModel = ({
  desktopApi,
  onMetaChange
}: UseAgentPlanBoardModelOptions): AgentPlanBoardModel => {
  const [, setStatesById] = useState<Record<string, AgentPlanBoardAppState>>({});
  const statesRef = useRef<Record<string, AgentPlanBoardAppState>>({});

  const publishMeta = useCallback((state: AgentPlanBoardAppState): void => {
    onMetaChange({
      appId: AGENT_PLAN_BOARD_APP_ID,
      appInstanceId: state.instanceId,
      title: state.title,
      iconKey: AGENT_PLAN_BOARD_ICON_KEY,
      fileSessionId: state.agentSessionId
    });
  }, [onMetaChange]);

  const replaceStates = useCallback((nextStates: Record<string, AgentPlanBoardAppState>): void => {
    statesRef.current = nextStates;
    setStatesById(nextStates);
  }, []);

  const getState = useCallback((instanceId: string): AgentPlanBoardAppState | null =>
    statesRef.current[instanceId] ?? null, []);

  const updateInstance = useCallback((
    instanceId: string,
    update: (state: AgentPlanBoardAppState) => AgentPlanBoardAppState
  ): AgentPlanBoardAppState | null => {
    const current = statesRef.current[instanceId];
    if (current === undefined) {
      return null;
    }
    const next = update(current);
    replaceStates({
      ...statesRef.current,
      [instanceId]: next
    });
    publishMeta(next);
    return next;
  }, [publishMeta, replaceStates]);

  const refreshManager = useCallback<AgentPlanBoardModel["refreshManager"]>(async (instanceId) => {
    const current = statesRef.current[instanceId];
    if (current?.mode !== "manager" || desktopApi?.agent === undefined) {
      return;
    }
    updateInstance(instanceId, (state) =>
      state.mode === "manager"
        ? { ...state, loading: true, error: null }
        : state
    );
    try {
      const response = await desktopApi.agent.listProjectPlans({
        sessionId: current.agentSessionId,
        workingDir: current.workingDir
      });
      updateInstance(instanceId, (state) =>
        state.mode === "manager"
          ? {
              ...state,
              projectKey: response.projectKey,
              plans: response.plans,
              loading: false,
              error: null
            }
          : state
      );
    } catch (error: unknown) {
      updateInstance(instanceId, (state) =>
        state.mode === "manager"
          ? { ...state, loading: false, error: toErrorMessage(error) }
          : state
      );
    }
  }, [desktopApi, updateInstance]);

  const ensureInstance = useCallback<AgentPlanBoardModel["ensureInstance"]>((instanceId, options) => {
    const title = options.title?.trim() || options.plan.title;
    const next: AgentPlanBoardAppState = {
      mode: "detail",
      instanceId,
      agentSessionId: options.agentSessionId,
      title,
      plan: options.plan,
      projectTodo: options.projectTodo ?? null
    };
    replaceStates({
      ...statesRef.current,
      [instanceId]: next
    });
    publishMeta(next);
  }, [publishMeta, replaceStates]);

  const ensureManagerInstance = useCallback<AgentPlanBoardModel["ensureManagerInstance"]>((instanceId, options) => {
    const current = statesRef.current[instanceId];
    const title = options.title?.trim() || "Plans and Todos";
    const next: AgentPlanBoardAppState = {
      mode: "manager",
      instanceId,
      agentSessionId: options.agentSessionId,
      workingDir: options.workingDir,
      title,
      projectKey: current?.mode === "manager" ? current.projectKey : null,
      plans: current?.mode === "manager" ? current.plans : [],
      loading: current?.mode === "manager" ? current.loading : true,
      error: null,
      selectedPlan: current?.mode === "manager" ? current.selectedPlan : null,
      selectedProjectTodo: current?.mode === "manager" ? current.selectedProjectTodo : null
    };
    replaceStates({
      ...statesRef.current,
      [instanceId]: next
    });
    publishMeta(next);
    void refreshManager(instanceId);
  }, [publishMeta, refreshManager, replaceStates]);

  const openManagedPlan = useCallback<AgentPlanBoardModel["openManagedPlan"]>(async (instanceId, planId) => {
    const current = statesRef.current[instanceId];
    if (current?.mode !== "manager" || desktopApi?.agent === undefined) {
      return;
    }
    updateInstance(instanceId, (state) =>
      state.mode === "manager"
        ? { ...state, loading: true, error: null }
        : state
    );
    try {
      const response = await desktopApi.agent.readProjectPlan({
        sessionId: current.agentSessionId,
        workingDir: current.workingDir,
        planId
      });
      const selectedPlan = planSnapshotFromProjectRead(response);
      updateInstance(instanceId, (state) =>
        state.mode === "manager"
          ? {
              ...state,
              title: selectedPlan.title,
              projectKey: response.projectKey,
              loading: false,
              error: null,
              selectedPlan,
              selectedProjectTodo: response.projectTodo
            }
          : state
      );
    } catch (error: unknown) {
      updateInstance(instanceId, (state) =>
        state.mode === "manager"
          ? { ...state, loading: false, error: toErrorMessage(error) }
          : state
      );
    }
  }, [desktopApi, updateInstance]);

  const deleteManagedPlan = useCallback<AgentPlanBoardModel["deleteManagedPlan"]>(async (instanceId, planId) => {
    const current = statesRef.current[instanceId];
    if (current?.mode !== "manager" || desktopApi?.agent === undefined) {
      return;
    }
    updateInstance(instanceId, (state) =>
      state.mode === "manager"
        ? { ...state, loading: true, error: null }
        : state
    );
    try {
      await desktopApi.agent.deleteProjectPlan({
        sessionId: current.agentSessionId,
        workingDir: current.workingDir,
        planId
      });
      updateInstance(instanceId, (state) =>
        state.mode === "manager"
          ? {
              ...state,
              plans: state.plans.filter((plan) => plan.planId !== planId),
              loading: false,
              selectedPlan: state.selectedPlan?.activePlanId === planId ? null : state.selectedPlan,
              selectedProjectTodo: state.selectedPlan?.activePlanId === planId
                ? null
                : state.selectedProjectTodo
            }
          : state
      );
      await refreshManager(instanceId);
    } catch (error: unknown) {
      updateInstance(instanceId, (state) =>
        state.mode === "manager"
          ? { ...state, loading: false, error: toErrorMessage(error) }
          : state
      );
    }
  }, [desktopApi, refreshManager, updateInstance]);

  const revisePlan = useCallback<AgentPlanBoardModel["revisePlan"]>(async (instanceId, request) => {
    const current = statesRef.current[instanceId];
    const currentPlan =
      current?.mode === "detail"
        ? current.plan
        : current?.mode === "manager"
          ? current.selectedPlan
          : null;
    if (current === undefined || currentPlan === null || desktopApi?.agent === undefined) {
      return;
    }
    const snapshot = await desktopApi.agent.revisePlan({
      sessionId: current.agentSessionId,
      planId: currentPlan.activePlanId,
      baseVersionId: currentPlan.activeVersionId,
      markdown: request.markdown,
      source: request.source,
      annotations: request.annotations,
      summary: request.summary ?? null
    });
    const nextPlan = snapshot.plan ?? {
      ...currentPlan,
      markdown: request.markdown,
      annotations: request.annotations,
      review: {
        status: "changed" as const,
        summary: request.summary ?? null
      }
    };
    const next: AgentPlanBoardAppState = current.mode === "detail"
      ? {
          ...current,
          title: nextPlan.title,
          plan: nextPlan,
          projectTodo: snapshot.projectTodo ?? current.projectTodo
        }
      : {
          ...current,
          title: nextPlan.title,
          selectedPlan: nextPlan,
          selectedProjectTodo: snapshot.projectTodo ?? current.selectedProjectTodo
        };
    replaceStates({
      ...statesRef.current,
      [instanceId]: next
    });
    publishMeta(next);
  }, [desktopApi, publishMeta, replaceStates]);

  const syncTabInstances = useCallback((instanceIds: readonly string[]) => {
    const kept = new Set(instanceIds);
    const next = Object.fromEntries(
      Object.entries(statesRef.current).filter(([instanceId]) => kept.has(instanceId))
    );
    if (Object.keys(next).length !== Object.keys(statesRef.current).length) {
      replaceStates(next);
    }
  }, [replaceStates]);

  return {
    getState,
    ensureInstance,
    ensureManagerInstance,
    refreshManager,
    openManagedPlan,
    deleteManagedPlan,
    revisePlan,
    syncTabInstances
  };
};

export type { AgentPlanBoardAppIconKey } from "./types";
