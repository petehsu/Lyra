import type { AiPanelAppOpenRequest } from "./types";

const MCP_CENTER_INSTANCE_ID = "ai-mcp-center";
const SKILLS_CENTER_INSTANCE_ID = "ai-skills-center";

const createId = (prefix: string): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
};

export const createAiPanelAppRequest = (
  title: string,
  sessionId = createId("ai-panel")
): AiPanelAppOpenRequest => ({
  appId: "ai-panel",
  appInstanceId: sessionId,
  title,
  iconKey: "ai-panel-default"
});

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
