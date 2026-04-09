import type { AiPanelAppOpenRequest } from "./types";

const MCP_CENTER_INSTANCE_ID = "ai-mcp-center";
const SKILLS_CENTER_INSTANCE_ID = "ai-skills-center";
const HISTORY_CENTER_INSTANCE_ID = "ai-history-center";

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

export const createAiHistoryAppRequest = (title: string): AiPanelAppOpenRequest => ({
  appId: "ai-history",
  appInstanceId: HISTORY_CENTER_INSTANCE_ID,
  title,
  iconKey: "ai-panel-history"
});
