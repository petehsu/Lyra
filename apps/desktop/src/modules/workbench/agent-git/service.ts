import type { WorkspaceAppTabOpenRequest } from "../workspace-tabs";
import type { AgentGitAppIconKey } from "./types";

export const AGENT_GIT_APP_ID = "agent-git" as const;
export const AGENT_GIT_ICON_KEY = "agent-git-default" as const satisfies AgentGitAppIconKey;

const normalizePath = (value: string): string => value.trim();

const normalizeInstanceToken = (value: string): string => {
  const token = value.trim().replace(/[^a-zA-Z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return token.length > 0 ? token : "unbound";
};

export const resolveAgentGitTitle = (rootPath: string): string => {
  const normalized = normalizePath(rootPath).replace(/[\\/]+$/u, "");
  if (normalized.length === 0) {
    return "Git";
  }
  const separatorIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const basename = separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
  return `Git: ${basename || normalized}`;
};

export const createAgentGitInstanceId = (agentSessionId: string): string =>
  `agent-git-${normalizeInstanceToken(agentSessionId)}`;

export const createAgentGitAppRequest = (
  agentSessionId: string,
  rootPath: string
): WorkspaceAppTabOpenRequest => ({
  appId: AGENT_GIT_APP_ID,
  appInstanceId: createAgentGitInstanceId(agentSessionId),
  title: resolveAgentGitTitle(rootPath),
  iconKey: AGENT_GIT_ICON_KEY,
  filePath: normalizePath(rootPath),
  fileSessionId: agentSessionId
});
