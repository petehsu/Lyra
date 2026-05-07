import type { AgentFollowSummary, AgentLiveDraftSummary } from "./agent-ui-types";

export type LiveDraftTone = "active" | "ready" | "committing" | "done" | "blocked";

export const activeLiveDraft = (
  followSummary: AgentFollowSummary | null | undefined
): AgentLiveDraftSummary | null => followSummary?.activeLiveDraft ?? null;

export const liveDraftLabel = (status: string): string => {
  switch (status) {
    case "ready_to_commit":
      return "Ready";
    case "committing":
      return "Committing";
    case "committed":
      return "Committed";
    case "discarded":
      return "Discarded";
    case "conflict":
      return "Conflict";
    case "failed":
      return "Failed";
    default:
      return "Drafting";
  }
};

export const liveDraftTone = (status: string): LiveDraftTone => {
  switch (status) {
    case "ready_to_commit":
      return "ready";
    case "committing":
      return "committing";
    case "committed":
    case "discarded":
      return "done";
    case "conflict":
    case "failed":
      return "blocked";
    default:
      return "active";
  }
};

export const liveDraftDetail = (draft: AgentLiveDraftSummary): string => {
  const deltaLabel = draft.deltaCount === 1 ? "1 delta" : `${String(draft.deltaCount)} deltas`;
  if (draft.commitOperationId !== undefined) {
    return `${draft.path} / ${draft.commitOperationId}`;
  }
  return `${draft.path} / ${deltaLabel}`;
};
