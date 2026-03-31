import type { AiActionEvent, AiMode, AiPlanStep, AiThreadMessage, ApprovalItem } from "../shell/types";

export type AiState = {
  readonly mode: AiMode;
  readonly plan: readonly AiPlanStep[];
  readonly actions: readonly AiActionEvent[];
  readonly approvals: readonly ApprovalItem[];
  readonly thread: readonly AiThreadMessage[];
};

export type AiActions = {
  readonly setMode: (mode: AiMode) => void;
  readonly setPlan: (steps: readonly AiPlanStep[]) => void;
  readonly pushAction: (event: AiActionEvent) => void;
  readonly addThreadMessage: (message: AiThreadMessage) => void;
  readonly requestApproval: (item: ApprovalItem) => void;
  readonly setApprovalStatus: (approvalId: string, status: ApprovalItem["status"]) => void;
  readonly clearActions: () => void;
};

export type AiStore = AiState & AiActions;
