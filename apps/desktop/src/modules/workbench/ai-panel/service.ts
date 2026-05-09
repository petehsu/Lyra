import type { AiPanelAppOpenRequest } from "./types";

const MCP_CENTER_INSTANCE_ID = "ai-mcp-center";
const SKILLS_CENTER_INSTANCE_ID = "ai-skills-center";
const HISTORY_CENTER_INSTANCE_ID = "ai-history-center";
const PLUGINS_CENTER_INSTANCE_ID = "ai-plugins-center";
const AGENT_VM_CENTER_INSTANCE_ID = "agent-vm-center";
const AGENT_VM_SESSION_INSTANCE_PREFIX = "agent-vm-session-";

export const createAiMcpAppRequest = (title: string): AiPanelAppOpenRequest => ({
  appId: "ai-mcp",
  appInstanceId: MCP_CENTER_INSTANCE_ID,
  title,
  iconKey: "ai-panel-mcp"
});

export const createAiSkillsAppRequest = (title: string): AiPanelAppOpenRequest => ({
  appId: "ai-skills",
  appInstanceId: SKILLS_CENTER_INSTANCE_ID,
  title,
  iconKey: "ai-panel-skills"
});

export const createAiPluginsAppRequest = (title: string): AiPanelAppOpenRequest => ({
  appId: "ai-plugins",
  appInstanceId: PLUGINS_CENTER_INSTANCE_ID,
  title,
  iconKey: "ai-panel-plugins"
});

export const createAiHistoryAppRequest = (title: string): AiPanelAppOpenRequest => ({
  appId: "ai-history",
  appInstanceId: HISTORY_CENTER_INSTANCE_ID,
  title,
  iconKey: "ai-panel-history"
});

export const createAgentVmAppRequest = (
  title: string,
  sessionId?: string | null
): AiPanelAppOpenRequest => ({
  appId: "agent-vm",
  appInstanceId:
    sessionId === undefined || sessionId === null || sessionId.trim().length === 0
      ? AGENT_VM_CENTER_INSTANCE_ID
      : `${AGENT_VM_SESSION_INSTANCE_PREFIX}${sessionId.trim()}`,
  title,
  iconKey: "ai-panel-agent-vm"
});

export const readAgentVmSessionIdFromAppInstanceId = (instanceId: string): string | null => {
  if (!instanceId.startsWith(AGENT_VM_SESSION_INSTANCE_PREFIX)) {
    return null;
  }
  const sessionId = instanceId.slice(AGENT_VM_SESSION_INSTANCE_PREFIX.length).trim();
  return sessionId.length === 0 ? null : sessionId;
};

export const createAiPlanReviewAppRequest = (
  title: string,
  instanceId: string
): AiPanelAppOpenRequest => ({
  appId: "ai-plan-review",
  appInstanceId: instanceId,
  title,
  iconKey: "ai-panel-plan"
});
