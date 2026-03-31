import type { AiActionEvent, AiMode, AiPlanStep, AiThreadMessage, ApprovalItem } from "../shell/types";

export type AiTowerProps = {
  readonly mode: AiMode;
  readonly plan: readonly AiPlanStep[];
  readonly actions: readonly AiActionEvent[];
  readonly approvals: readonly ApprovalItem[];
  readonly thread: readonly AiThreadMessage[];
  readonly onModeChange: (mode: AiMode) => void;
  readonly onSendMessage: (content: string) => void;
  readonly onApprove: (approvalId: string) => void;
  readonly onReject: (approvalId: string) => void;
};
