import type { JsonValue } from "@lyra/app-runtime";

import type { WorkspaceTab } from "../workspace-tabs/types";
import type { AgentSubagentOpaqueState } from "./types";

export const AGENT_SUBAGENT_APP_ID = "agent-subagent" as const;
export const AGENT_SUBAGENT_ICON_KEY = "agent-subagent-default" as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Array.isArray(value) === false;

const nonEmpty = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const parseSubagentOpaqueState = (value: unknown): AgentSubagentOpaqueState | null => {
  if (isRecord(value) === false) {
    return null;
  }
  const parentSessionId = nonEmpty(value.parentSessionId);
  const subagentId = nonEmpty(value.subagentId);
  if (parentSessionId === null || subagentId === null) {
    return null;
  }
  const planId = nonEmpty(value.planId);
  return {
    parentSessionId,
    subagentId,
    ...(planId === null ? {} : { planId })
  };
};

export const subagentSplitGroupKey = (state: {
  readonly parentSessionId: string;
  readonly planId?: string | null;
}): string => {
  const planId = typeof state.planId === "string" ? state.planId.trim() : "";
  if (planId.length > 0) {
    return `plan:${planId}`;
  }
  return `spawn:${state.parentSessionId.trim()}`;
};

export const tabSubagentOpaqueState = (tab: WorkspaceTab): AgentSubagentOpaqueState | null => {
  if (tab.pageKind !== "app" || tab.appId !== AGENT_SUBAGENT_APP_ID) {
    return null;
  }
  return parseSubagentOpaqueState(tab.appOpaqueState);
};

export const isSubagentTabInGroup = (
  tab: WorkspaceTab,
  groupKey: string
): boolean => {
  const state = tabSubagentOpaqueState(tab);
  return state !== null && subagentSplitGroupKey(state) === groupKey;
};

export const orderSubagentSplitTabIds = (
  currentSplitTabIds: readonly string[],
  siblingTabIds: readonly string[],
  nextTabId: string
): readonly string[] => {
  const siblingSet = new Set(siblingTabIds);
  siblingSet.add(nextTabId);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const tabId of currentSplitTabIds) {
    if (siblingSet.has(tabId) === false || seen.has(tabId)) {
      continue;
    }
    seen.add(tabId);
    ordered.push(tabId);
  }
  for (const tabId of siblingTabIds) {
    if (seen.has(tabId)) {
      continue;
    }
    seen.add(tabId);
    ordered.push(tabId);
  }
  if (seen.has(nextTabId) === false) {
    ordered.push(nextTabId);
  }
  return ordered;
};

export const toSubagentOpaqueJson = (
  state: AgentSubagentOpaqueState
): JsonValue => ({
  parentSessionId: state.parentSessionId,
  subagentId: state.subagentId,
  ...(state.planId === undefined || state.planId === null || state.planId.trim().length === 0
    ? {}
    : { planId: state.planId })
});
