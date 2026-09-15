import { useCallback, useRef, useState } from "react";

import type { WorkspaceAppTabMetaRequest, WorkspaceAppTabOpenRequest } from "../workspace-tabs";
import {
  AGENT_SUBAGENT_APP_ID,
  AGENT_SUBAGENT_ICON_KEY,
  toSubagentOpaqueJson
} from "./group";
import type {
  AgentSubagentAppState,
  AgentSubagentModel
} from "./types";

export { AGENT_SUBAGENT_APP_ID, AGENT_SUBAGENT_ICON_KEY };

const normalizeInstanceToken = (value: string): string => {
  const token = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return token.length > 0 ? token : "unbound";
};

export const createAgentSubagentInstanceId = (subagentId: string): string =>
  `agent-subagent-${normalizeInstanceToken(subagentId)}`;

export const createAgentSubagentAppRequest = (
  parentSessionId: string,
  subagentId: string,
  title: string,
  planId?: string | null
): WorkspaceAppTabOpenRequest => ({
  appId: AGENT_SUBAGENT_APP_ID,
  appInstanceId: createAgentSubagentInstanceId(subagentId),
  title,
  iconKey: AGENT_SUBAGENT_ICON_KEY,
  fileSessionId: parentSessionId,
  opaqueState: toSubagentOpaqueJson({
    parentSessionId,
    subagentId,
    ...(planId === undefined || planId === null || planId.trim().length === 0
      ? {}
      : { planId })
  })
});

type UseAgentSubagentModelOptions = {
  readonly onMetaChange: (request: WorkspaceAppTabMetaRequest) => void;
};

export const useAgentSubagentModel = ({
  onMetaChange
}: UseAgentSubagentModelOptions): AgentSubagentModel => {
  const [, setStatesById] = useState<Record<string, AgentSubagentAppState>>({});
  const statesRef = useRef<Record<string, AgentSubagentAppState>>({});

  const publishMeta = useCallback((state: AgentSubagentAppState): void => {
    onMetaChange({
      appId: AGENT_SUBAGENT_APP_ID,
      appInstanceId: state.instanceId,
      title: state.title,
      iconKey: AGENT_SUBAGENT_ICON_KEY,
      fileSessionId: state.parentSessionId,
      opaqueState: toSubagentOpaqueJson({
        parentSessionId: state.parentSessionId,
        subagentId: state.subagentId,
        ...(state.planId === null ? {} : { planId: state.planId })
      })
    });
  }, [onMetaChange]);

  const replaceStates = useCallback((nextStates: Record<string, AgentSubagentAppState>): void => {
    statesRef.current = nextStates;
    setStatesById(nextStates);
  }, []);

  const getState = useCallback((instanceId: string): AgentSubagentAppState | null =>
    statesRef.current[instanceId] ?? null, []);

  const ensureInstance = useCallback<AgentSubagentModel["ensureInstance"]>((instanceId, options) => {
    const parentSessionId = options.parentSessionId.trim();
    const subagentId = options.subagentId.trim();
    const planId = options.planId?.trim() || null;
    const title = options.title?.trim() || "Agent";
    const next: AgentSubagentAppState = {
      instanceId,
      parentSessionId,
      subagentId,
      planId,
      title
    };
    replaceStates({
      ...statesRef.current,
      [instanceId]: next
    });
    publishMeta(next);
  }, [publishMeta, replaceStates]);

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
    syncTabInstances
  };
};
