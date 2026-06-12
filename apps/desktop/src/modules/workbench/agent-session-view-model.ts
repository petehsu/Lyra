import type {
  AgentModelCatalogSnapshot,
  AgentSessionSnapshot,
  AgentSidePanelSnapshot
} from "../../shared/agent";
import type { AgentSidePanel, ModelOption, SessionMeta, TodoItem } from "./ai-panel/lyra-agents/core/types";
import { formatMessage } from "./ai-panel/lyra-agents/core/i18n";

export { applyAgentRuntimeEventToSnapshot } from "./agent-session-view-model/runtime-reducer";
export {
  agentSessionToChatMessages,
  cleanSyntheticImageText,
  formatAgentMessageTime
} from "./agent-session-view-model/message-view-model";

export const agentSessionToSessionMeta = (
  session: AgentSessionSnapshot | null
): SessionMeta => {
  const workingDir = normalizeSessionWorkingDir(session?.workingDir);
  const projectBound = session?.projectBound ?? false;
  return {
    id: session?.id ?? null,
    title: session?.title ?? "Lyra Agent",
    project: projectBound ? projectNameFromWorkingDir(workingDir) : "",
    workingDir,
    projectBound,
    automation: session?.automation ?? null,
    totalAdditions: 0,
    totalDeletions: 0
  };
};

export const agentSessionToSidePanel = (
  session: AgentSessionSnapshot | null
): AgentSidePanel | null => {
  if (session?.sidePanel === undefined || session.sidePanel.pages.length === 0) {
    return null;
  }
  return sidePanelSnapshotToViewModel(session.sidePanel);
};

const sidePanelSnapshotToViewModel = (
  snapshot: AgentSidePanelSnapshot
): AgentSidePanel => ({
  focusedPageId: snapshot.focusedPageId ?? null,
  pages: snapshot.pages.map((page) => ({
    id: page.id,
    title: page.title,
    content: page.content,
    updatedAtMs: page.updatedAtMs,
    filePath: page.filePath,
    format: page.format,
    source: page.source
  }))
});

const normalizeSessionWorkingDir = (value: string | null | undefined): string | null => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length === 0 ? null : trimmed;
};

const projectNameFromWorkingDir = (workingDir: string | null): string => {
  if (workingDir === null) return "";
  const segments = workingDir.split(/[\\/]+/).filter(Boolean);
  return segments.at(-1) ?? workingDir;
};

const todoStatus = (raw: unknown): TodoItem["status"] => {
  if (typeof raw !== "string") return "pending";
  const value = raw.trim().toLowerCase();
  if (["completed", "complete", "done", "success", "succeeded", "cancelled", "canceled"].includes(value)) return "done";
  if (["in_progress", "running", "active", "current", "working"].includes(value)) return "running";
  return "pending";
};

export const agentSessionToTodos = (
  session: AgentSessionSnapshot | null
): TodoItem[] => {
  if (session === null) return [];
  return session.todos
    .map((todo, index) => ({
      id: todo.id,
      title: todo.content.trim().length > 0
        ? todo.content
        : formatMessage("todo.fallback", { index: index + 1 }),
      status: todoStatus(todo.status)
    }))
    .filter((todo) => todo.title.trim().length > 0);
};

export const agentModelsToModelOptions = (
  state: AgentModelCatalogSnapshot | null
): ModelOption[] =>
  (state?.models ?? [])
    .filter((model) =>
      model.available &&
      (
        (model.provider ?? "").trim().length > 0 ||
        (model.providerLabel ?? "").trim().length > 0 ||
        (model.apiMethod ?? "").trim().length > 0
      )
    )
    .map((model) => ({
      id: model.id,
      label: model.label,
      model: model.model,
      provider: model.providerLabel ?? model.provider ?? null,
      detail: model.detail ?? model.apiMethod ?? null,
      available: model.available
    }));
