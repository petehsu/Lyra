import { useCallback, useRef, useState } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { WorkspaceAppTabMetaRequest, WorkspaceAppTabOpenRequest } from "../workspace-tabs";
import type {
  AgentPlanBoardAppState,
  AgentPlanBoardModel
} from "./types";

export const AGENT_PLAN_BOARD_APP_ID = "agent-plan-board" as const;
export const AGENT_PLAN_BOARD_ICON_KEY = "agent-plan-board-default" as const;

const normalizeInstanceToken = (value: string): string => {
  const token = value.trim().replace(/[^a-zA-Z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return token.length > 0 ? token : "unbound";
};

export const createAgentPlanBoardInstanceId = (agentSessionId: string): string =>
  `agent-plan-board-${normalizeInstanceToken(agentSessionId)}`;

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

type UseAgentPlanBoardModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly onMetaChange: (request: WorkspaceAppTabMetaRequest) => void;
};

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

  const ensureInstance = useCallback<AgentPlanBoardModel["ensureInstance"]>((instanceId, options) => {
    const title = options.title?.trim() || options.plan.title;
    const next: AgentPlanBoardAppState = {
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

  const revisePlan = useCallback<AgentPlanBoardModel["revisePlan"]>(async (instanceId, request) => {
    const current = statesRef.current[instanceId];
    if (current === undefined || desktopApi?.agent === undefined) {
      return;
    }
    const snapshot = await desktopApi.agent.revisePlan({
      sessionId: current.agentSessionId,
      planId: current.plan.activePlanId,
      baseVersionId: current.plan.activeVersionId,
      markdown: request.markdown,
      source: request.source,
      annotations: request.annotations,
      summary: request.summary ?? null
    });
    const nextPlan = snapshot.plan ?? {
      ...current.plan,
      markdown: request.markdown,
      annotations: request.annotations,
      review: {
        status: "changed" as const,
        summary: request.summary ?? null
      }
    };
    const next: AgentPlanBoardAppState = {
      ...current,
      title: nextPlan.title,
      plan: nextPlan,
      projectTodo: snapshot.projectTodo ?? current.projectTodo
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
    revisePlan,
    syncTabInstances
  };
};

export type { AgentPlanBoardAppIconKey } from "./types";
